import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runSecurityScanPreview, type SecurityScanResult } from "./security-scanner.js";

const SCHEDULER_VERSION = "2026.06.30-monthly-local";
const DEFAULT_STATE_DIR = path.join(process.cwd(), ".local", "security-scans");
const STATE_DIR = process.env.PHANTOMFORCE_SECURITY_SCAN_STATE_DIR ?? DEFAULT_STATE_DIR;
const STATE_FILE = path.join(STATE_DIR, "monthly-scan-state.json");
const DAY_MS = 24 * 60 * 60 * 1000;

type AutonomousScanTarget = {
  id: string;
  label: string;
  mode: SecurityScanResult["mode"];
  filename: string;
  content: string;
};

type AutonomousScanRecord = {
  target_id: string;
  target_label: string;
  scanned_at: string;
  summary: SecurityScanResult["summary"];
  finding_titles: Array<{
    severity: string;
    kind: string;
    title: string;
  }>;
};

type PasswordHealthAccount = {
  account_id: string;
  workspace: string;
  account_label: string;
  role: "owner_admin" | "business_admin" | "test_client_admin";
  password_age_known: false;
  last_password_change_at: null;
  rotation_interval_days: 180;
  rotation_status: "baseline_needed";
  breach_check_status: "check_on_next_password_change";
  recommendation: string;
};

type PasswordHealthProof = {
  proof_id: string;
  checked_at: string;
  policy: {
    unique_password_required: true;
    rotation_interval_days: 180;
    breach_check_timing: "password_change_or_reset_only";
    plaintext_password_storage: false;
  };
  summary: {
    total_admin_accounts: number;
    baseline_needed: number;
    rotation_due_or_unknown: number;
    breach_check_ready: true;
    breached_passwords_found: null;
  };
  accounts: PasswordHealthAccount[];
  safety_flags: {
    plaintext_password_stored: false;
    raw_password_logged: false;
    external_breach_provider_called: false;
    credential_printed: false;
  };
};

type AutonomousSecurityScanState = {
  scheduler_version: string;
  enabled: boolean;
  cadence: "monthly";
  current_month_key: string;
  proof_id: string;
  last_run_at: string | null;
  last_success_month_key: string | null;
  next_run_after: string;
  run_count: number;
  targets: AutonomousScanRecord[];
  password_health: PasswordHealthProof;
  safety_flags: {
    local_only: true;
    synthetic_targets_only: true;
    destructive_action: false;
    external_scan_provider_called: false;
    upload_performed: false;
    raw_content_stored: false;
  };
};

export type AutonomousSecurityScanStatus = AutonomousSecurityScanState & {
  status: "active" | "disabled" | "waiting" | "ran_this_month";
  state_file: string;
  target_count: number;
};

type LoggerLike = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: unknown) => void;
};

function currentMonthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function nextMonthIso(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0)).toISOString();
}

function proofId(monthKey: string, runCount: number) {
  return `PF-SEC-${monthKey}-${String(runCount).padStart(3, "0")}`;
}

function autonomousTargets(): AutonomousScanTarget[] {
  return [
    {
      id: "dashboard-shell",
      label: "Dashboard shell copy",
      mode: "website",
      filename: "phantomforce-dashboard-copy.txt",
      content:
        "PhantomForce owner cockpit. Mission bundles, agents, approvals, review queue, site studio, store builder, scanner, bookings, content, media, and access controls.",
    },
    {
      id: "store-builder-default",
      label: "Store Builder default draft",
      mode: "website",
      filename: "store-builder-default-draft.txt",
      content:
        "PhantomForce Store. Ops + Content Setup Sprint. $1,500. Checkout is gated. No payment link, invoice, publish, send, or billing action is created without approval.",
    },
    {
      id: "client-upload-policy",
      label: "Client upload and page policy copy",
      mode: "message",
      filename: "client-upload-policy.txt",
      content:
        "Client uploads, page copy, code snippets, and message text should be scanned before being shown to customers. Raw tools, credentials, secrets, and admin internals stay hidden.",
    },
    {
      id: "approval-gate-copy",
      label: "Approval gate language",
      mode: "website",
      filename: "approval-gate-copy.txt",
      content:
        "Sends, posts, bookings, billing, checkout, deploys, deletes, credentials, route changes, and production changes require Jordan approval before execution.",
    },
  ];
}

function passwordHealthAccounts(): Omit<PasswordHealthAccount, "password_age_known" | "last_password_change_at" | "rotation_interval_days" | "rotation_status" | "breach_check_status" | "recommendation">[] {
  return [
    {
      account_id: "admin-jordan",
      workspace: "PhantomForce",
      account_label: "Jordan owner/admin",
      role: "owner_admin",
    },
    {
      account_id: "client-chicagoshots-admin",
      workspace: "ChicagoShots",
      account_label: "ChicagoShots business admin",
      role: "business_admin",
    },
    {
      account_id: "client-test-admin",
      workspace: "Test Client",
      account_label: "Test client business admin",
      role: "test_client_admin",
    },
  ];
}

function buildPasswordHealthProof(checkedAt: string, monthKey: string, runCount: number): PasswordHealthProof {
  const accounts = passwordHealthAccounts().map((account) => ({
    ...account,
    password_age_known: false as const,
    last_password_change_at: null,
    rotation_interval_days: 180 as const,
    rotation_status: "baseline_needed" as const,
    breach_check_status: "check_on_next_password_change" as const,
    recommendation:
      "Set or confirm a unique password baseline, then rotate every 180 days. Breach checks should run during password change/reset without storing plaintext passwords.",
  }));

  return {
    proof_id: `PF-PWD-${monthKey}-${String(runCount).padStart(3, "0")}`,
    checked_at: checkedAt,
    policy: {
      unique_password_required: true,
      rotation_interval_days: 180,
      breach_check_timing: "password_change_or_reset_only",
      plaintext_password_storage: false,
    },
    summary: {
      total_admin_accounts: accounts.length,
      baseline_needed: accounts.length,
      rotation_due_or_unknown: accounts.length,
      breach_check_ready: true,
      breached_passwords_found: null,
    },
    accounts,
    safety_flags: {
      plaintext_password_stored: false,
      raw_password_logged: false,
      external_breach_provider_called: false,
      credential_printed: false,
    },
  };
}

function blankState(): AutonomousSecurityScanState {
  const now = new Date();
  const monthKey = currentMonthKey(now);
  return {
    scheduler_version: SCHEDULER_VERSION,
    enabled: true,
    cadence: "monthly",
    current_month_key: monthKey,
    proof_id: proofId(monthKey, 0),
    last_run_at: null,
    last_success_month_key: null,
    next_run_after: nextMonthIso(now),
    run_count: 0,
    targets: [],
    password_health: buildPasswordHealthProof(now.toISOString(), monthKey, 0),
    safety_flags: {
      local_only: true,
      synthetic_targets_only: true,
      destructive_action: false,
      external_scan_provider_called: false,
      upload_performed: false,
      raw_content_stored: false,
    },
  };
}

async function readState() {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<AutonomousSecurityScanState>;
    const fallback = blankState();
    const merged = {
      ...fallback,
      ...parsed,
      safety_flags: fallback.safety_flags,
    };
    const runCount = merged.run_count ?? 0;
    const monthKey = merged.current_month_key ?? currentMonthKey();
    const checkedAt = merged.last_run_at ?? new Date().toISOString();

    return {
      ...merged,
      proof_id: parsed.proof_id ?? proofId(monthKey, runCount),
      password_health:
        parsed.password_health ?? buildPasswordHealthProof(checkedAt, monthKey, runCount),
    };
  } catch {
    return blankState();
  }
}

async function writeState(state: AutonomousSecurityScanState) {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function runAutonomousMonthlySecurityScan(reason = "scheduled_monthly") {
  const now = new Date();
  const monthKey = currentMonthKey(now);
  const previous = await readState();

  if (previous.last_success_month_key === monthKey) {
    return {
      ran: false,
      reason: "already_ran_this_month" as const,
      state: {
        ...previous,
        current_month_key: monthKey,
        next_run_after: nextMonthIso(now),
      },
    };
  }

  const records = autonomousTargets().map((target) => {
    const result = runSecurityScanPreview({
      label: target.label,
      filename: target.filename,
      mode: target.mode,
      content: target.content,
    });

    return {
      target_id: target.id,
      target_label: target.label,
      scanned_at: result.scanned_at,
      summary: result.summary,
      finding_titles: result.findings.map((finding) => ({
        severity: finding.severity,
        kind: finding.kind,
        title: finding.title,
      })),
    };
  });

  const nextState: AutonomousSecurityScanState = {
    ...previous,
    scheduler_version: SCHEDULER_VERSION,
    enabled: true,
    current_month_key: monthKey,
    proof_id: proofId(monthKey, (previous.run_count ?? 0) + 1),
    last_run_at: now.toISOString(),
    last_success_month_key: monthKey,
    next_run_after: nextMonthIso(now),
    run_count: (previous.run_count ?? 0) + 1,
    targets: records,
    password_health: buildPasswordHealthProof(now.toISOString(), monthKey, (previous.run_count ?? 0) + 1),
    safety_flags: blankState().safety_flags,
  };

  await writeState(nextState);

  return {
    ran: true,
    reason,
    state: nextState,
  };
}

export async function getAutonomousSecurityScanStatus(): Promise<AutonomousSecurityScanStatus> {
  const state = await readState();
  const monthKey = currentMonthKey();
  const ranThisMonth = state.last_success_month_key === monthKey;

  return {
    ...state,
    current_month_key: monthKey,
    next_run_after: ranThisMonth ? nextMonthIso() : new Date().toISOString(),
    status: !state.enabled ? "disabled" : ranThisMonth ? "ran_this_month" : "waiting",
    state_file: STATE_FILE,
    target_count: autonomousTargets().length,
    safety_flags: blankState().safety_flags,
  };
}

export function startAutonomousSecurityScanScheduler(logger: LoggerLike) {
  if (process.env.PHANTOMFORCE_SECURITY_SCHEDULER_ENABLED === "false") {
    logger.info("PhantomForce autonomous security scanner disabled by environment.");
    return () => undefined;
  }

  void runAutonomousMonthlySecurityScan("server_startup_monthly_catchup")
    .then((result) => {
      logger.info(
        result.ran
          ? "PhantomForce autonomous monthly security scan completed."
          : "PhantomForce autonomous monthly security scan already current.",
      );
    })
    .catch((error) => {
      logger.warn(`PhantomForce autonomous security scan failed non-fatally: ${String(error)}`);
    });

  const timer = setInterval(() => {
    void runAutonomousMonthlySecurityScan("daily_monthly_due_check").catch((error) => {
      logger.warn(`PhantomForce autonomous security scan check failed non-fatally: ${String(error)}`);
    });
  }, DAY_MS);

  timer.unref();

  return () => clearInterval(timer);
}
