import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { getHermesLedgerStatus, readRedactedHermesLedgerRecords, redactSensitiveText } from "./hermes-ledger.js";
import {
  getHermesInteractionMemoryStoreStatus,
  readHermesInteractionMemoryStoreRecords,
} from "./hermes-interaction-memory-store.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const DEFAULT_PROCESS_VAULT_PATH = "C:\\Users\\jorda\\Documents\\Obsidian\\PhantomForce-Command-Center";
const MAX_SOURCE_FILES = 40;
const MAX_SEARCH_RESULTS = 20;
const MAX_SNIPPET_CHARS = 220;
const ALLOWED_EXTENSIONS = new Set([".md", ".txt", ".json"]);
const BLOCKED_PATH_PATTERN = /(^|[\\/])(\.env|env|secrets?|tokens?|cookies?|credentials?|keys?)([\\/]|\.|$)/i;

export type OwnerCodexMemoryArtifact = {
  source: "process_vault" | "repo_docs";
  path: string;
  bytes: number;
  modified_at: string;
  match_snippet?: string;
};

function cleanQuery(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

function safeRelative(root: string, path: string) {
  return relative(root, path).replace(/\\/g, "/");
}

function isAllowedArtifactPath(path: string) {
  if (BLOCKED_PATH_PATTERN.test(path)) return false;
  return ALLOWED_EXTENSIONS.has(extname(path).toLowerCase());
}

async function pathStatus(path: string) {
  try {
    const info = await stat(path);
    return {
      exists: true,
      path,
      bytes: info.size,
      modified_at: info.mtime.toISOString(),
    };
  } catch {
    return {
      exists: false,
      path,
      bytes: 0,
      modified_at: null,
    };
  }
}

async function walkArtifacts(
  root: string,
  source: OwnerCodexMemoryArtifact["source"],
  options: { limit?: number; query?: string; maxDepth?: number } = {},
) {
  const limit = options.limit ?? MAX_SOURCE_FILES;
  const maxDepth = options.maxDepth ?? 5;
  const query = cleanQuery(options.query).toLowerCase();
  const results: OwnerCodexMemoryArtifact[] = [];

  async function walk(dir: string, depth: number) {
    if (results.length >= limit || depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= limit) return;
      if (entry.name.startsWith(".") && entry.name !== ".codex") continue;
      const fullPath = join(dir, entry.name);
      if (BLOCKED_PATH_PATTERN.test(fullPath)) continue;

      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
        continue;
      }

      if (!entry.isFile() || !isAllowedArtifactPath(fullPath)) continue;

      const info = await stat(fullPath).catch(() => null);
      if (!info) continue;

      let match_snippet: string | undefined;
      if (query) {
        const raw = await readFile(fullPath, "utf8").catch(() => "");
        const redacted = redactSensitiveText(raw);
        const idx = redacted.toLowerCase().indexOf(query);
        if (idx < 0) continue;
        const start = Math.max(0, idx - 70);
        match_snippet = redacted.slice(start, start + MAX_SNIPPET_CHARS).replace(/\s+/g, " ").trim();
      }

      results.push({
        source,
        path: safeRelative(root, fullPath),
        bytes: info.size,
        modified_at: info.mtime.toISOString(),
        ...(match_snippet ? { match_snippet } : {}),
      });
    }
  }

  await walk(root, 0);
  return results;
}

export async function buildOwnerCodexMemoryStatus(options: {
  query?: unknown;
  limit?: unknown;
  processVaultPath?: string;
  repoDocsPath?: string;
} = {}) {
  const query = cleanQuery(options.query);
  const parsedLimit = Number(options.limit ?? MAX_SOURCE_FILES);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(Math.floor(parsedLimit), 1), MAX_SOURCE_FILES)
    : MAX_SOURCE_FILES;
  const processVaultPath = resolve(
    options.processVaultPath ?? process.env.PHANTOMFORCE_PROCESS_VAULT_PATH ?? DEFAULT_PROCESS_VAULT_PATH,
  );
  const repoDocsPath = resolve(options.repoDocsPath ?? join(repoRoot, "docs"));
  const [processVault, repoDocs, hermesLedger, interactionStore] = await Promise.all([
    pathStatus(processVaultPath),
    pathStatus(repoDocsPath),
    getHermesLedgerStatus(),
    getHermesInteractionMemoryStoreStatus(),
  ]);
  const [vaultArtifacts, docsArtifacts, hermesRecords, interactionRecords] = await Promise.all([
    processVault.exists
      ? walkArtifacts(processVaultPath, "process_vault", {
          limit: query ? MAX_SEARCH_RESULTS : Math.ceil(limit / 2),
          query,
        })
      : [],
    repoDocs.exists
      ? walkArtifacts(repoDocsPath, "repo_docs", {
          limit: query ? MAX_SEARCH_RESULTS : Math.ceil(limit / 2),
          query,
        })
      : [],
    readRedactedHermesLedgerRecords({ limit: 8 }),
    readHermesInteractionMemoryStoreRecords({ limit: 8 }),
  ]);

  return {
    generated_at: new Date().toISOString(),
    access_model: {
      owner_admin_only: true,
      owner_default_tenant_id: "phantomforce-owner",
      client_memory_rule: "Clients are forced to their session clientId tenant and cannot request owner memory.",
      admin_selected_tenant_rule: "Jordan/admin may intentionally inspect selected workspace tenants.",
      raw_codex_internal_memory_exposed: false,
      sanitized_local_codex_artifacts_exposed: true,
    },
    sources: {
      process_vault: {
        ...processVault,
        purpose: "Sanitized process memory, decisions, handoffs, and verification notes.",
      },
      repo_docs: {
        ...repoDocs,
        purpose: "Local PhantomForce docs and implementation records.",
      },
      hermes_ledger: {
        ...hermesLedger,
        purpose: "Redacted admin/client AI run receipts and context records.",
      },
      interaction_memory_store: {
        ...interactionStore,
        purpose: "Redacted PhantomAI interaction memory store.",
      },
    },
    query: query || null,
    artifacts: [...vaultArtifacts, ...docsArtifacts].slice(0, limit),
    recent_hermes_records: hermesRecords,
    recent_interaction_records: interactionRecords.records.map((record) => ({
      record_id: record.record_id,
      tenant_id: record.tenant_id,
      actor_user_id: record.actor_user_id,
      interaction_type: record.interaction_type,
      captured_at: record.captured_at,
      safe_summary: redactSensitiveText(record.memory_record.safe_summary),
    })),
    safety_flags: {
      admin_only: true,
      client_visible: false,
      local_files_only: true,
      redacted: true,
      env_files_excluded: true,
      secrets_paths_excluded: true,
      provider_called: false,
      network_call_performed: false,
      external_send: false,
      raw_secret_exposed: false,
    },
  };
}
