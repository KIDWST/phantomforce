#!/usr/bin/env node
import fs from "node:fs";

const API = "https://api.apify.com/v2";

function parseArgs(argv) {
  const out = { execute: false, dryRun: true, wait: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--execute") { out.execute = true; out.dryRun = false; continue; }
    if (arg === "--dry-run") { out.dryRun = true; out.execute = false; continue; }
    if (arg === "--wait") { out.wait = true; continue; }
    if (arg.startsWith("--")) {
      out[arg.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

function readJson(path) {
  if (!path) return {};
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function actorPath(actor) {
  if (!actor || !actor.includes("/")) throw new Error("Use actor in owner/name form, e.g. apify/google-search-scraper");
  return encodeURIComponent(actor.replace("/", "~"));
}

async function api(path, { token, method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text}`);
  return data?.data || data;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRun({ token, runId }) {
  for (;;) {
    const run = await api(`/actor-runs/${runId}`, { token });
    if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) return run;
    await sleep(5000);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const input = readJson(args.input);
  const actor = args.actor;
  const actorUrl = `/acts/${actorPath(actor)}/runs`;

  if (args.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      actor,
      endpoint: `${API}${actorUrl}`,
      inputPreview: input,
      nextStep: "Set APIFY_TOKEN server-side and rerun with --execute after owner approval.",
    }, null, 2));
    return;
  }

  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is required for --execute and must be set server-side.");

  const run = await api(actorUrl, { token, method: "POST", body: input });
  const finalRun = args.wait ? await waitForRun({ token, runId: run.id }) : run;
  const result = {
    actor,
    runId: finalRun.id,
    status: finalRun.status,
    defaultDatasetId: finalRun.defaultDatasetId,
    datasetItemsUrl: finalRun.defaultDatasetId ? `${API}/datasets/${finalRun.defaultDatasetId}/items?clean=true` : null,
    reviewGate: "Pull dataset, summarize, dedupe, and create Phantom review cards before any outward action.",
  };
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
