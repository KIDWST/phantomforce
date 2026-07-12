/* PhantomForce website publishing pipeline.
   Draft (in-browser builder) → registered build (validated static HTML on
   disk + DB row) → approval-gated publish (via the ONE agent-run engine) →
   verified deployment with a receipt → rollback to any prior version.

   Nothing here pretends: a site is "published" only when a validated build
   was promoted by an approved run, the deployment row exists, and the served
   content hash matches the build on disk. Domains are never "connected"
   because someone typed them — the DNS adapter has to verify ownership. */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { PrismaClient } from "@prisma/client";

import { getOrgEntitlements, orgHasFeature } from "../access/entitlements.js";
import { prisma } from "../access/prisma-runtime.js";
import { recordOrgAuditEvent } from "../access/user-accounts.js";
import { registerAgentRunExecutor } from "../phantom-ai/agent-runs.js";
import { getDnsAdapter, isPlausibleDomain } from "./dns-adapter.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const BUILDS_DIR = resolve(repoRoot, ".phantom", "site-builds");
const MAX_BUILD_BYTES = 512 * 1024;

function requirePrisma(): PrismaClient {
  if (!prisma) throw new Error("Site publishing requires DATABASE_URL (Prisma repository mode).");
  return prisma;
}

const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export type SiteSnapshot = {
  siteId?: string;
  title: string;
  sections: string[];
  design: {
    brand?: string;
    headline?: string;
    subhead?: string;
    offer?: string;
    cta?: string;
    theme?: string;
    style?: string;
  };
};

const THEME_COLORS: Record<string, { bg: string; accent: string; ink: string }> = {
  dark: { bg: "#0c1116", accent: "#41ffa1", ink: "#eef4f0" },
  gold: { bg: "#161206", accent: "#ffd166", ink: "#fff6e0" },
  light: { bg: "#f7f8fa", accent: "#0f7b5f", ink: "#15221c" },
  crimson: { bg: "#160a0c", accent: "#ff5964", ink: "#ffeef0" },
};

/* Deterministic server-side static rendering — self-contained HTML, no
   external requests, everything escaped. */
export function renderSiteHtml(snapshot: SiteSnapshot): string {
  const theme = THEME_COLORS[snapshot.design.theme ?? "dark"] ?? THEME_COLORS.dark;
  const sections = snapshot.sections
    .map((section) => {
      const body =
        section.toLowerCase() === "contact"
          ? `<p>Reach ${esc(snapshot.design.brand || snapshot.title)} — contact details go live once connected.</p>`
          : section.toLowerCase() === "offer" && snapshot.design.offer
            ? `<p>${esc(snapshot.design.offer)}</p>`
            : `<p>${esc(snapshot.design.subhead || "")}</p>`;
      return `<section id="${esc(section.toLowerCase().replace(/\s+/g, "-"))}"><h2>${esc(section)}</h2>${body}</section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(snapshot.title)}</title>
<style>
  :root { color-scheme: dark light; }
  * { box-sizing: border-box; margin: 0; }
  body { font: 16px/1.6 system-ui, sans-serif; background: ${theme.bg}; color: ${theme.ink}; }
  header { padding: 72px 24px; text-align: center; }
  header h1 { font-size: clamp(28px, 6vw, 52px); }
  header p { margin-top: 12px; opacity: .8; }
  .cta { display: inline-block; margin-top: 24px; padding: 12px 28px; border-radius: 999px; background: ${theme.accent}; color: ${theme.bg}; font-weight: 700; text-decoration: none; }
  section { max-width: 860px; margin: 0 auto; padding: 40px 24px; border-top: 1px solid ${theme.accent}33; }
  section h2 { color: ${theme.accent}; margin-bottom: 10px; }
  footer { padding: 40px 24px; text-align: center; opacity: .6; font-size: 13px; }
</style>
</head>
<body>
<header>
  <h1>${esc(snapshot.design.headline || snapshot.title)}</h1>
  ${snapshot.design.subhead ? `<p>${esc(snapshot.design.subhead)}</p>` : ""}
  ${snapshot.design.cta ? `<a class="cta" href="#contact">${esc(snapshot.design.cta)}</a>` : ""}
</header>
${sections}
<footer>${esc(snapshot.design.brand || snapshot.title)} · Published with PhantomForce</footer>
</body>
</html>`;
}

function validateBuild(html: string, snapshot: SiteSnapshot): { ok: boolean; log: string[] } {
  const log: string[] = [];
  let ok = true;
  const bytes = Buffer.byteLength(html, "utf8");
  log.push(`size: ${bytes} bytes (limit ${MAX_BUILD_BYTES})`);
  if (bytes > MAX_BUILD_BYTES) { ok = false; log.push("FAIL: build exceeds size limit"); }
  if (!html.includes("<title>")) { ok = false; log.push("FAIL: missing <title>"); } else log.push("ok: <title> present");
  for (const section of snapshot.sections) {
    const id = section.toLowerCase().replace(/\s+/g, "-");
    if (html.includes(`id="${id}"`)) log.push(`ok: section "${section}" rendered`);
    else { ok = false; log.push(`FAIL: section "${section}" missing from output`); }
  }
  if (/<script[^>]+src=/i.test(html)) { ok = false; log.push("FAIL: external scripts are not allowed in published builds"); }
  else log.push("ok: no external scripts");
  log.push(ok ? "RESULT: validated" : "RESULT: failed");
  return { ok, log };
}

export function contentHash(html: string) {
  return createHash("sha256").update(html).digest("hex");
}

/* ---------------- builds ---------------- */

export async function createSiteBuild(input: {
  orgId: string;
  actorUserId: string | null;
  actorEmail: string;
  snapshot: SiteSnapshot;
}) {
  const db = requirePrisma();
  const feature = await orgHasFeature(input.orgId, "websites");
  if (!feature.allowed) return { ok: false as const, error: "feature_not_available", reason: feature.reason };

  let site = input.snapshot.siteId
    ? await db.site.findFirst({ where: { id: input.snapshot.siteId, orgId: input.orgId } })
    : null;
  if (input.snapshot.siteId && !site) return { ok: false as const, error: "site_not_found_in_org" };
  if (!site) {
    const entitlements = await getOrgEntitlements(input.orgId);
    const siteCount = await db.site.count({ where: { orgId: input.orgId } });
    if (siteCount >= entitlements.limits.sitesPerOrg) {
      return { ok: false as const, error: "site_limit_reached", limit: entitlements.limits.sitesPerOrg };
    }
    site = await db.site.create({ data: { orgId: input.orgId, title: input.snapshot.title.slice(0, 160) } });
  } else if (site.title !== input.snapshot.title) {
    site = await db.site.update({ where: { id: site.id }, data: { title: input.snapshot.title.slice(0, 160) } });
  }

  const html = renderSiteHtml(input.snapshot);
  const validation = validateBuild(html, input.snapshot);
  const latest = await db.siteBuild.findFirst({ where: { siteId: site.id }, orderBy: { version: "desc" } });
  const version = (latest?.version ?? 0) + 1;
  const contentPath = resolve(BUILDS_DIR, site.id, `v${version}`, "index.html");
  await mkdir(dirname(contentPath), { recursive: true });
  await writeFile(contentPath, html, "utf8");

  const build = await db.siteBuild.create({
    data: {
      siteId: site.id,
      orgId: input.orgId,
      version,
      status: validation.ok ? "validated" : "failed",
      contentPath,
      buildLog: validation.log.join("\n"),
      createdByUserId: input.actorUserId,
    },
  });
  return { ok: true as const, site, build, validated: validation.ok, buildLog: validation.log };
}

export async function getBuildHtml(orgId: string, siteId: string, buildId: string) {
  const db = requirePrisma();
  const build = await db.siteBuild.findFirst({ where: { id: buildId, siteId, orgId } });
  if (!build) return null;
  try {
    return await readFile(build.contentPath, "utf8");
  } catch {
    return null;
  }
}

/* ---------------- deployments ---------------- */

export async function getCurrentDeployment(siteId: string) {
  const db = requirePrisma();
  return db.siteDeployment.findFirst({
    where: { siteId, status: "published" },
    orderBy: { publishedAt: "desc" },
    include: { build: true },
  });
}

export async function getPublishedHtml(siteId: string) {
  const deployment = await getCurrentDeployment(siteId);
  if (!deployment) return null;
  try {
    const html = await readFile(deployment.build.contentPath, "utf8");
    return { html, deployment };
  } catch {
    return null;
  }
}

async function promoteBuild(input: {
  orgId: string;
  siteId: string;
  buildId: string;
  actor: string;
  approvedBy: string | null;
  runId: string | null;
  rollbackOfDeploymentId?: string;
}) {
  const db = requirePrisma();
  const build = await db.siteBuild.findFirst({ where: { id: input.buildId, siteId: input.siteId, orgId: input.orgId } });
  if (!build) return { ok: false as const, error: "build_not_found" };
  if (build.status !== "validated") return { ok: false as const, error: `build_not_validated:${build.status}` };
  const html = await readFile(build.contentPath, "utf8").catch(() => null);
  if (!html) return { ok: false as const, error: "build_content_missing" };

  await db.siteDeployment.updateMany({
    where: { siteId: input.siteId, status: "published" },
    data: { status: "superseded" },
  });
  const receipt = {
    build_version: build.version,
    build_id: build.id,
    content_sha256: contentHash(html),
    published_by: input.actor,
    approved_by: input.approvedBy,
    run_id: input.runId,
    public_path: `/public/sites/${input.siteId}`,
    ...(input.rollbackOfDeploymentId ? { rollback_of_deployment: input.rollbackOfDeploymentId } : {}),
  };
  const deployment = await db.siteDeployment.create({
    data: {
      siteId: input.siteId,
      orgId: input.orgId,
      buildId: build.id,
      status: "published",
      publishedByUserId: null,
      approvedByUserId: null,
      runId: input.runId,
      receipt: receipt as object,
    },
  });
  return { ok: true as const, deployment, receipt, build };
}

export async function rollbackSite(input: { orgId: string; siteId: string; actorEmail: string }) {
  const db = requirePrisma();
  const current = await getCurrentDeployment(input.siteId);
  if (!current || current.orgId !== input.orgId) return { ok: false as const, error: "nothing_published" };
  const previous = await db.siteDeployment.findFirst({
    where: { siteId: input.siteId, publishedAt: { lt: current.publishedAt }, NOT: { buildId: current.buildId } },
    orderBy: { publishedAt: "desc" },
  });
  if (!previous) return { ok: false as const, error: "no_prior_version" };
  await db.siteDeployment.update({ where: { id: current.id }, data: { status: "rolled_back" } });
  const promoted = await promoteBuild({
    orgId: input.orgId,
    siteId: input.siteId,
    buildId: previous.buildId,
    actor: input.actorEmail,
    approvedBy: input.actorEmail,
    runId: null,
    rollbackOfDeploymentId: current.id,
  });
  if (!promoted.ok) return promoted;
  await recordOrgAuditEvent({
    orgId: input.orgId,
    actor: input.actorEmail,
    eventType: "site.rolled_back",
    targetType: "site",
    targetId: input.siteId,
    payload: { from_deployment: current.id, to_build: previous.buildId },
  });
  return promoted;
}

export async function listOrgSites(orgId: string) {
  const db = requirePrisma();
  const sites = await db.site.findMany({
    where: { orgId },
    orderBy: { createdAt: "asc" },
    include: {
      builds: { orderBy: { version: "desc" }, take: 10 },
      deployments: { orderBy: { publishedAt: "desc" }, take: 10, include: { build: { select: { version: true } } } },
      domains: true,
    },
  });
  return sites.map((site) => ({
    id: site.id,
    title: site.title,
    createdAt: site.createdAt.toISOString(),
    builds: site.builds.map((build) => ({
      id: build.id,
      version: build.version,
      status: build.status,
      createdAt: build.createdAt.toISOString(),
    })),
    deployments: site.deployments.map((deployment) => ({
      id: deployment.id,
      status: deployment.status,
      buildVersion: deployment.build.version,
      publishedAt: deployment.publishedAt.toISOString(),
      runId: deployment.runId,
      receipt: deployment.receipt,
    })),
    currentDeployment: site.deployments.find((d) => d.status === "published")?.id ?? null,
    publicPath: site.deployments.some((d) => d.status === "published") ? `/public/sites/${site.id}` : null,
    domains: site.domains.map((domain) => ({
      id: domain.id,
      domain: domain.domain,
      state: domain.state,
      sslState: domain.sslState,
      verificationToken: domain.verificationToken,
      checkedAt: domain.checkedAt?.toISOString() ?? null,
      lastError: domain.lastError,
    })),
  }));
}

/* ---------------- domains ---------------- */

export async function addSiteDomain(input: { orgId: string; siteId: string; domain: string; actorEmail: string }) {
  const db = requirePrisma();
  const feature = await orgHasFeature(input.orgId, "customDomains");
  if (!feature.allowed) return { ok: false as const, error: "feature_not_available", reason: feature.reason };
  const domain = input.domain.trim().toLowerCase();
  if (!isPlausibleDomain(domain)) return { ok: false as const, error: "invalid_domain" };
  const site = await db.site.findFirst({ where: { id: input.siteId, orgId: input.orgId } });
  if (!site) return { ok: false as const, error: "site_not_found_in_org" };
  const record = await db.siteDomain.create({
    data: {
      siteId: input.siteId,
      orgId: input.orgId,
      domain,
      state: "verification_required",
      verificationToken: `pf-verify-${randomBytes(16).toString("hex")}`,
    },
  });
  await recordOrgAuditEvent({
    orgId: input.orgId,
    actor: input.actorEmail,
    eventType: "site.domain_added",
    targetType: "site_domain",
    targetId: record.id,
    payload: { domain },
  });
  return { ok: true as const, domain: record };
}

export async function verifySiteDomain(input: { orgId: string; domainId: string }) {
  const db = requirePrisma();
  const record = await db.siteDomain.findFirst({ where: { id: input.domainId, orgId: input.orgId } });
  if (!record) return { ok: false as const, error: "domain_not_found" };
  const adapter = getDnsAdapter();
  const result = await adapter.checkDomain(record.domain, record.verificationToken);
  const updated = await db.siteDomain.update({
    where: { id: record.id },
    data: {
      state: result.state,
      sslState: result.sslState,
      checkedAt: new Date(result.checkedAt),
      lastError: result.state === "failed" || result.state === "misconfigured" ? result.detail : null,
    },
  });
  return { ok: true as const, domain: updated, check: result };
}

/* ---------------- the approval-gated publish executor ----------------
   Registered on the ONE agent-run engine: risk external_approval means the
   run is created awaiting_approval and only an org manager (or super-admin)
   approval makes it execute. */

export function registerPublishingExecutor() {
  registerAgentRunExecutor("publish_site", {
    title: "Publish website",
    description: "Promotes a validated build to the live PhantomForce-hosted URL for this site. External action: always requires approval.",
    risk: "external_approval",
    requiredRole: "org_manager",
    scope: "one site's public URL",
    expectedEffect: "The site's /public/sites/<siteId> URL starts serving the approved build.",
    rollbackGuidance: "POST /orgs/<orgId>/sites/<siteId>/rollback restores the previous published version.",
    async execute({ run, progress }) {
      const { siteId, buildId } = run.inputs as { siteId?: string; buildId?: string };
      if (!siteId || !buildId) throw new Error("publish_site requires inputs.siteId and inputs.buildId");

      await progress("Checking publishing entitlement…");
      const feature = await orgHasFeature(run.workspace, "websitePublishing");
      if (!feature.allowed) throw new Error(`publishing_not_entitled:${feature.reason}`);

      await progress("Promoting validated build to published…");
      const promoted = await promoteBuild({
        orgId: run.workspace,
        siteId,
        buildId,
        actor: run.requested_by,
        approvedBy: run.approved_by,
        runId: run.id,
      });
      if (!promoted.ok) throw new Error(promoted.error);

      await recordOrgAuditEvent({
        orgId: run.workspace,
        actor: run.approved_by ?? run.requested_by,
        eventType: "site.published",
        targetType: "site",
        targetId: siteId,
        payload: { buildId, deploymentId: promoted.deployment.id, runId: run.id },
      });

      const artifactBody = [
        `# Deployment receipt — ${siteId}`,
        ``,
        `- run: ${run.id}`,
        `- build: v${promoted.build.version} (${buildId})`,
        `- content sha256: ${promoted.receipt.content_sha256}`,
        `- requested by: ${run.requested_by}`,
        `- approved by: ${run.approved_by ?? "(pending record)"}`,
        `- public path: ${promoted.receipt.public_path}`,
        `- rollback: ${`POST /orgs/${run.workspace}/sites/${siteId}/rollback`}`,
      ].join("\n");
      const path = resolve(BUILDS_DIR, siteId, `deployment-${promoted.deployment.id}.md`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, artifactBody, "utf8");

      return {
        artifacts: [{ kind: "markdown" as const, path, summary: `v${promoted.build.version} live at ${promoted.receipt.public_path}` }],
        summary: `Published build v${promoted.build.version} to ${promoted.receipt.public_path}`,
        actualEffect: `Site ${siteId} now serves build v${promoted.build.version} (sha256 ${promoted.receipt.content_sha256.slice(0, 12)}…)`,
      };
    },
    async verify({ run }) {
      /* real deployment verification: the current published deployment must
         point at the requested build AND the served content must match the
         build on disk byte-for-byte. */
      const { siteId, buildId } = run.inputs as { siteId: string; buildId: string };
      const current = await getCurrentDeployment(siteId);
      if (!current) return { ok: false, detail: "no published deployment found after publish" };
      if (current.buildId !== buildId) return { ok: false, detail: `current deployment serves ${current.buildId}, expected ${buildId}` };
      const served = await getPublishedHtml(siteId);
      if (!served) return { ok: false, detail: "published content unreadable from disk" };
      const receipt = current.receipt as { content_sha256?: string };
      const actual = contentHash(served.html);
      if (receipt.content_sha256 && receipt.content_sha256 !== actual) {
        return { ok: false, detail: "served content hash does not match the deployment receipt" };
      }
      return { ok: true, detail: `deployment verified: build ${buildId} live, content sha256 ${actual.slice(0, 12)}… matches receipt` };
    },
  });
}
