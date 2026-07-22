/*
 * Defensive Seatbelt posture adapter.
 *
 * GhostPack Seatbelt is a broad host-survey project. Its useful defensive
 * checks sit beside modules that can enumerate credentials, browser artifacts,
 * user files, and remote systems. PhantomForce deliberately exposes none of
 * those capabilities. This adapter executes only a fixed local posture
 * allowlist, requires an operator-pinned binary SHA-256, retains no raw output,
 * and returns normalized security signals only.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const ADAPTER_VERSION = "2026.07.22-seatbelt-defensive-posture-v1";
const MAX_BINARY_BYTES = 50 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;

/* No groups, -full, output files, remote switches, or user-supplied commands. */
export const SEATBELT_DEFENSIVE_COMMANDS = [
  "AntiVirus",
  "CredGuard",
  "SecureBoot",
  "UAC",
  "WindowsDefender",
  "WindowsFirewall",
] as const;

export const SeatbeltPostureRunRequestSchema = z.object({
  confirmation: z.literal("RUN_LOCAL_SEATBELT_POSTURE"),
});

type PostureOutcome = "pass" | "review" | "unknown";

type PostureSignal = {
  id: string;
  label: string;
  outcome: PostureOutcome;
  detail: string;
  recommendation: string;
};

export type SeatbeltPostureResult = {
  ok: boolean;
  status: "disabled" | "unsupported_platform" | "configuration_required" | "integrity_blocked" | "completed" | "timed_out" | "output_limited" | "execution_failed" | "already_running";
  ran_at: string | null;
  summary: {
    verdict: "pass" | "review" | "incomplete";
    checks_passed: number;
    checks_for_review: number;
    checks_unknown: number;
  } | null;
  signals: PostureSignal[];
  safety: ReturnType<typeof safetyContract>;
};

type SeatbeltConfig = {
  enabled: boolean;
  executablePath: string;
  expectedSha256: string;
  timeoutMs: number;
};

type ProcessResult = {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  outputLimited: boolean;
  failedToStart: boolean;
};

let activeRun: Promise<SeatbeltPostureResult> | null = null;

function enabled(value: string | undefined) {
  return /^(1|true|yes|on)$/iu.test(String(value || "").trim());
}

function text(value: string | undefined) {
  return String(value || "").trim();
}

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function config(): SeatbeltConfig {
  return {
    enabled: enabled(process.env.PHANTOMFORCE_SEATBELT_POSTURE_ENABLED),
    executablePath: text(process.env.PHANTOMFORCE_SEATBELT_PATH),
    expectedSha256: text(process.env.PHANTOMFORCE_SEATBELT_SHA256).toLowerCase(),
    timeoutMs: boundedNumber(process.env.PHANTOMFORCE_SEATBELT_TIMEOUT_MS, 45_000, 10_000, 120_000),
  };
}

function safetyContract() {
  return {
    platform_operator_only: true,
    local_host_only: true,
    explicit_confirmation_required: "RUN_LOCAL_SEATBELT_POSTURE",
    binary_sha256_pin_required: true,
    remote_enumeration: false,
    credential_collection: false,
    browser_data_collection: false,
    user_file_enumeration: false,
    raw_output_returned: false,
    raw_output_persisted: false,
    external_network_calls: false,
    remediation_performed: false,
    command_allowlist: [...SEATBELT_DEFENSIVE_COMMANDS],
  };
}

function configurationState(input = config()) {
  if (process.platform !== "win32") return "unsupported_platform" as const;
  if (!input.enabled) return "disabled" as const;
  if (!input.executablePath || !path.isAbsolute(input.executablePath) || path.extname(input.executablePath).toLowerCase() !== ".exe") {
    return "configuration_required" as const;
  }
  if (!/^[a-f0-9]{64}$/iu.test(input.expectedSha256)) return "configuration_required" as const;
  if (!existsSync(input.executablePath)) return "configuration_required" as const;
  return "ready" as const;
}

export function getSeatbeltDefensivePostureStatus() {
  const current = config();
  const state = configurationState(current);
  return {
    adapter_version: ADAPTER_VERSION,
    provider: "GhostPack Seatbelt" as const,
    configured: state === "ready",
    enabled: current.enabled,
    state,
    ready_to_run: state === "ready",
    binary_path_exposed: false,
    binary_sha256_verified: false,
    timeout_ms: current.timeoutMs,
    safety: safetyContract(),
    reason:
      state === "ready"
        ? "A local, hash-pinned Seatbelt binary is configured. The next run will verify its SHA-256 before executing the defensive allowlist."
        : state === "disabled"
          ? "Seatbelt posture checks are disabled by default."
          : state === "unsupported_platform"
            ? "Seatbelt defensive posture checks are available only on Windows."
            : "Set an absolute Seatbelt.exe path and its SHA-256, then explicitly enable the posture adapter server-side.",
  };
}

async function verifyPinnedBinary(input: SeatbeltConfig) {
  try {
    const info = await lstat(input.executablePath);
    if (!info.isFile() || info.size < 1 || info.size > MAX_BINARY_BYTES) return { ok: false as const, reason: "binary_invalid" };
    const bytes = await readFile(input.executablePath);
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== input.expectedSha256) return { ok: false as const, reason: "binary_hash_mismatch" };
    return { ok: true as const };
  } catch {
    return { ok: false as const, reason: "binary_unavailable" };
  }
}

function runAllowlistedCommands(input: SeatbeltConfig): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let finished = false;
    let output = "";
    let timedOut = false;
    let outputLimited = false;
    let failedToStart = false;
    let child: ReturnType<typeof spawn>;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (exitCode: number | null) => {
      if (finished) return;
      finished = true;
      if (timeout) clearTimeout(timeout);
      resolve({ exitCode, output, timedOut, outputLimited, failedToStart });
    };
    const append = (chunk: unknown) => {
      const next = String(chunk || "");
      const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(output, "utf8");
      if (remaining <= 0) {
        outputLimited = true;
        child.kill();
        return;
      }
      const sliced = Buffer.byteLength(next, "utf8") <= remaining ? next : Buffer.from(next).subarray(0, remaining).toString("utf8");
      output += sliced;
      if (sliced.length !== next.length) {
        outputLimited = true;
        child.kill();
      }
    };

    try {
      child = spawn(input.executablePath, [...SEATBELT_DEFENSIVE_COMMANDS], {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      failedToStart = true;
      finish(null);
      return;
    }

    timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.timeoutMs);

    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", () => {
      failedToStart = true;
      finish(null);
    });
    child.on("close", (exitCode) => finish(exitCode));
  });
}

function containsFieldValue(output: string, fields: string[], value: "true" | "false" | "one" | "zero") {
  const expected = value === "one" ? "1" : value === "zero" ? "0" : value;
  const field = fields.map((item) => item.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|");
  return new RegExp(`(?:${field})[^\\r\\n]{0,100}\\b${expected}\\b`, "iu").test(output);
}

function signal(input: {
  id: string;
  label: string;
  output: string;
  fields: string[];
  positive?: "true" | "one";
  negative?: "false" | "zero";
  positiveDetail: string;
  reviewDetail: string;
  recommendation: string;
}): PostureSignal {
  const negative = input.negative && containsFieldValue(input.output, input.fields, input.negative);
  if (negative) return { id: input.id, label: input.label, outcome: "review", detail: input.reviewDetail, recommendation: input.recommendation };
  const positive = input.positive && containsFieldValue(input.output, input.fields, input.positive);
  if (positive) return { id: input.id, label: input.label, outcome: "pass", detail: input.positiveDetail, recommendation: "No action needed from this limited check." };
  return {
    id: input.id,
    label: input.label,
    outcome: "unknown",
    detail: "The allowlisted Seatbelt output did not provide a normalized value for this posture signal.",
    recommendation: input.recommendation,
  };
}

/* Exported for contract tests. Raw Seatbelt output never leaves this module. */
export function summarizeSeatbeltDefensiveOutput(rawOutput: string): PostureSignal[] {
  const output = String(rawOutput || "").replace(/\u0000/gu, "");
  return [
    signal({
      id: "antivirus_realtime",
      label: "Antivirus and real-time protection",
      output,
      fields: ["AntivirusEnabled", "RealTimeProtectionEnabled", "AMServiceEnabled"],
      positive: "true",
      negative: "false",
      positiveDetail: "Seatbelt reported an enabled antivirus or real-time protection control.",
      reviewDetail: "Seatbelt reported an antivirus or real-time protection control as disabled.",
      recommendation: "Enable and update the endpoint protection product, then verify real-time protection.",
    }),
    signal({
      id: "secure_boot",
      label: "Secure Boot",
      output,
      fields: ["Is Secure Boot Enabled", "Secure Boot Enabled", "SecureBoot"],
      positive: "true",
      negative: "false",
      positiveDetail: "Seatbelt reported Secure Boot enabled.",
      reviewDetail: "Seatbelt reported Secure Boot disabled.",
      recommendation: "Confirm firmware support and enable Secure Boot where the device and operating system support it.",
    }),
    signal({
      id: "uac",
      label: "User Account Control",
      output,
      fields: ["EnableLUA"],
      positive: "one",
      negative: "zero",
      positiveDetail: "Seatbelt reported User Account Control enabled.",
      reviewDetail: "Seatbelt reported User Account Control disabled.",
      recommendation: "Enable User Account Control and review elevation-prompt policy.",
    }),
    signal({
      id: "credential_guard",
      label: "Credential Guard",
      output,
      fields: ["Credential Guard", "CredentialGuard"],
      positive: "true",
      negative: "false",
      positiveDetail: "Seatbelt reported Credential Guard enabled.",
      reviewDetail: "Seatbelt reported Credential Guard disabled.",
      recommendation: "Assess whether Credential Guard is supported and appropriate for this Windows host.",
    }),
    signal({
      id: "firewall",
      label: "Windows Firewall",
      output,
      fields: ["EnableFirewall", "FirewallEnabled"],
      positive: "one",
      negative: "zero",
      positiveDetail: "Seatbelt reported Windows Firewall enabled for at least one observed profile.",
      reviewDetail: "Seatbelt reported a Windows Firewall control disabled.",
      recommendation: "Review Domain, Private, and Public firewall profiles and enable the required controls.",
    }),
  ];
}

function resultFromSignals(signals: PostureSignal[]) {
  const checksPassed = signals.filter((item) => item.outcome === "pass").length;
  const checksForReview = signals.filter((item) => item.outcome === "review").length;
  const checksUnknown = signals.filter((item) => item.outcome === "unknown").length;
  return {
    verdict: checksForReview ? "review" as const : checksUnknown ? "incomplete" as const : "pass" as const,
    checks_passed: checksPassed,
    checks_for_review: checksForReview,
    checks_unknown: checksUnknown,
  };
}

async function executeSeatbeltDefensivePosture(): Promise<SeatbeltPostureResult> {
  const current = config();
  const state = configurationState(current);
  if (state !== "ready") {
    return {
      ok: false,
      status: state,
      ran_at: null,
      summary: null,
      signals: [],
      safety: safetyContract(),
    };
  }

  const verified = await verifyPinnedBinary(current);
  if (!verified.ok) {
    return {
      ok: false,
      status: "integrity_blocked",
      ran_at: null,
      summary: null,
      signals: [],
      safety: safetyContract(),
    };
  }

  const processResult = await runAllowlistedCommands(current);
  if (processResult.timedOut || processResult.outputLimited || processResult.failedToStart || processResult.exitCode !== 0) {
    return {
      ok: false,
      status: processResult.timedOut ? "timed_out" : processResult.outputLimited ? "output_limited" : "execution_failed",
      ran_at: new Date().toISOString(),
      summary: null,
      signals: [],
      safety: safetyContract(),
    };
  }

  const signals = summarizeSeatbeltDefensiveOutput(processResult.output);
  return {
    ok: true,
    status: "completed",
    ran_at: new Date().toISOString(),
    summary: resultFromSignals(signals),
    signals,
    safety: safetyContract(),
  };
}

export async function runSeatbeltDefensivePosture(): Promise<SeatbeltPostureResult> {
  if (activeRun) {
    return {
      ok: false,
      status: "already_running",
      ran_at: null,
      summary: null,
      signals: [],
      safety: safetyContract(),
    };
  }
  activeRun = executeSeatbeltDefensivePosture();
  try {
    return await activeRun;
  } finally {
    activeRun = null;
  }
}
