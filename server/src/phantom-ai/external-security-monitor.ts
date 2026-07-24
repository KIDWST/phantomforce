import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as dns } from "node:dns";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import tls from "node:tls";

import { z } from "zod";

import { runSecurityScanPreview } from "./security-scanner.js";

const MONITOR_VERSION = "2026.07.04-external-monitor-v1";
const MAX_DOMAIN_COUNT = 8;
const MAX_EMAIL_COUNT = 12;
const MAX_CONTENT_CHARS = 120_000;
const FETCH_TIMEOUT_MS = 8000;
const PROCESS_TIMEOUT_MS = 30_000;
const HISTORY_STATE_DIR = path.join(process.cwd(), ".local", "security-scans");
const HISTORY_STATE_FILE = path.join(HISTORY_STATE_DIR, "external-monitor-history.json");

type ExternalMonitorHistory = { last_run_at: string; verdict: "clean" | "review" | "blocked"; findings_count: number };

function readExternalMonitorHistory(): ExternalMonitorHistory | null {
  try {
    if (!existsSync(HISTORY_STATE_FILE)) return null;
    const raw = JSON.parse(readFileSync(HISTORY_STATE_FILE, "utf8"));
    if (!raw || typeof raw.last_run_at !== "string") return null;
    return raw as ExternalMonitorHistory;
  } catch {
    return null;
  }
}

async function writeExternalMonitorHistory(entry: ExternalMonitorHistory) {
  try {
    await mkdir(HISTORY_STATE_DIR, { recursive: true });
    await writeFile(HISTORY_STATE_FILE, JSON.stringify(entry, null, 2), "utf8");
  } catch {
    /* history is best-effort local record-keeping; a failed write must never block the scan result */
  }
}

type MonitorSeverity = "ok" | "info" | "warn" | "blocked";

export const ExternalSecurityMonitorRequestSchema = z.object({
  domains: z.array(z.string().trim().min(1).max(255)).max(MAX_DOMAIN_COUNT).default([]).optional(),
  emails: z.array(z.string().trim().email().max(254)).max(MAX_EMAIL_COUNT).default([]).optional(),
  label: z.string().trim().max(160).optional(),
  filename: z.string().trim().max(260).optional(),
  content: z.string().max(MAX_CONTENT_CHARS).optional(),
  enable_external_calls: z.boolean().default(true).optional(),
});

export type ExternalSecurityMonitorRequest = z.infer<typeof ExternalSecurityMonitorRequestSchema>;

type ConnectorStatus = {
  id: string;
  name: string;
  configured: boolean;
  active: boolean;
  note: string;
};

type MonitorFinding = {
  severity: MonitorSeverity;
  area: string;
  title: string;
  detail: string;
  recommendation: string;
};

function envPresent(...names: string[]) {
  return names.some((name) => Boolean(process.env[name]?.trim()));
}

function connectorStatus(): ConnectorStatus[] {
  const clam = findClamAv();
  const defender = findWindowsDefender();
  return [
    {
      id: "dns_tls_headers",
      name: "Domain, DNS, SSL, and website headers",
      configured: true,
      active: true,
      note: "Uses public DNS, TLS, and HTTPS header checks.",
    },
    {
      id: "clamav",
      name: "ClamAV",
      configured: Boolean(clam),
      active: Boolean(clam),
      note: clam ? `Found ${clam}` : "clamscan was not found on this Windows host.",
    },
    {
      id: "windows_defender",
      name: "Windows Defender",
      configured: Boolean(defender),
      active: Boolean(defender),
      note: defender ? "Available as local antivirus fallback." : "MpCmdRun.exe was not found.",
    },
    {
      id: "hibp_account_breach",
      name: "Have I Been Pwned account breach feed",
      configured: envPresent("HIBP_API_KEY", "HAVEIBEENPWNED_API_KEY"),
      active: envPresent("HIBP_API_KEY", "HAVEIBEENPWNED_API_KEY"),
      note: "Requires an API key and sends the checked email to HIBP when enabled.",
    },
    {
      id: "hibp_pwned_passwords",
      name: "Pwned Passwords k-anonymity check",
      configured: true,
      active: true,
      note: "Ready for password-change flow. This monitor never accepts raw passwords.",
    },
    {
      id: "virustotal",
      name: "VirusTotal domain/file reputation",
      configured: envPresent("VIRUSTOTAL_API_KEY"),
      active: envPresent("VIRUSTOTAL_API_KEY"),
      note: "Requires API key. Not called unless configured.",
    },
    {
      id: "google_safe_browsing",
      name: "Google Safe Browsing",
      configured: envPresent("GOOGLE_SAFE_BROWSING_API_KEY"),
      active: envPresent("GOOGLE_SAFE_BROWSING_API_KEY"),
      note: "Requires API key. Not called unless configured.",
    },
  ];
}

export function getExternalSecurityMonitorStatus() {
  return {
    monitor_version: MONITOR_VERSION,
    configured: true,
    connectors: connectorStatus(),
    history: readExternalMonitorHistory(),
    safety: {
      admin_only: true,
      destructive_action: false,
      upload_performed: false,
      deletes_files: false,
      plaintext_passwords_accepted: false,
      raw_credentials_returned: false,
    },
  };
}

function normalizeDomain(raw: string) {
  const trimmed = raw.trim().toLowerCase();
  let hostname = trimmed;
  try {
    hostname = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname.toLowerCase();
  } catch {
    hostname = trimmed;
  }
  hostname = hostname.replace(/^\.+|\.+$/g, "");
  if (!/^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i.test(hostname)) return null;
  if (hostname === "localhost" || hostname.endsWith(".local")) return null;
  return hostname;
}

function addFinding(findings: MonitorFinding[], finding: MonitorFinding) {
  findings.push(finding);
}

async function dnsRecord(domain: string) {
  const [mx, txt, dmarc] = await Promise.allSettled([
    dns.resolveMx(domain),
    dns.resolveTxt(domain),
    dns.resolveTxt(`_dmarc.${domain}`),
  ]);
  const txtFlat = txt.status === "fulfilled" ? txt.value.map((parts) => parts.join("")) : [];
  const dmarcFlat = dmarc.status === "fulfilled" ? dmarc.value.map((parts) => parts.join("")) : [];
  return {
    mx: mx.status === "fulfilled" ? mx.value : [],
    spf: txtFlat.find((record) => /^v=spf1\b/i.test(record)) ?? null,
    dmarc: dmarcFlat.find((record) => /^v=dmarc1\b/i.test(record)) ?? null,
    errors: {
      mx: mx.status === "rejected" ? String(mx.reason?.message ?? mx.reason) : null,
      txt: txt.status === "rejected" ? String(txt.reason?.message ?? txt.reason) : null,
      dmarc: dmarc.status === "rejected" ? String(dmarc.reason?.message ?? dmarc.reason) : null,
    },
  };
}

async function tlsRecord(domain: string) {
  return new Promise<{
    ok: boolean;
    valid_to: string | null;
    issuer: string | null;
    days_remaining: number | null;
    error: string | null;
  }>((resolve) => {
    const socket = tls.connect({ host: domain, port: 443, servername: domain, timeout: FETCH_TIMEOUT_MS }, () => {
      const cert = socket.getPeerCertificate();
      const validTo = cert.valid_to || null;
      const daysRemaining = validTo ? Math.floor((new Date(validTo).getTime() - Date.now()) / 86_400_000) : null;
      const issuerValue = cert.issuer?.O || cert.issuer?.CN || null;
      const issuer = Array.isArray(issuerValue) ? issuerValue.join(", ") : issuerValue;
      socket.end();
      resolve({
        ok: true,
        valid_to: validTo,
        issuer,
        days_remaining: Number.isFinite(daysRemaining) ? daysRemaining : null,
        error: null,
      });
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ ok: false, valid_to: null, issuer: null, days_remaining: null, error: "TLS check timed out" });
    });
    socket.on("error", (error) => {
      resolve({ ok: false, valid_to: null, issuer: null, days_remaining: null, error: error.message });
    });
  });
}

async function httpHeaders(domain: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`https://${domain}`, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "PhantomForce-SecurityMonitor/1.0" },
    });
    const header = (name: string) => response.headers.get(name);
    return {
      ok: true,
      status: response.status,
      headers: {
        strict_transport_security: header("strict-transport-security"),
        content_security_policy: header("content-security-policy"),
        x_frame_options: header("x-frame-options"),
        x_content_type_options: header("x-content-type-options"),
        referrer_policy: header("referrer-policy"),
        permissions_policy: header("permissions-policy"),
      },
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      headers: {},
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function evaluateDomain(domain: string, dnsInfo: Awaited<ReturnType<typeof dnsRecord>>, tlsInfo: Awaited<ReturnType<typeof tlsRecord>>, headerInfo: Awaited<ReturnType<typeof httpHeaders>>) {
  const findings: MonitorFinding[] = [];
  if (!dnsInfo.spf) {
    addFinding(findings, {
      severity: "warn",
      area: "email",
      title: "SPF record missing",
      detail: `${domain} does not show an SPF TXT record.`,
      recommendation: "Add SPF so mail servers know who can send email for this domain.",
    });
  }
  if (!dnsInfo.dmarc) {
    addFinding(findings, {
      severity: "warn",
      area: "email",
      title: "DMARC record missing",
      detail: `${domain} does not show a DMARC TXT record.`,
      recommendation: "Add DMARC so spoofed email is easier to block and report.",
    });
  }
  if (!tlsInfo.ok) {
    addFinding(findings, {
      severity: "warn",
      area: "ssl",
      title: "SSL check failed",
      detail: tlsInfo.error || "Could not verify TLS certificate.",
      recommendation: "Confirm HTTPS works and certificate is valid.",
    });
  } else if (typeof tlsInfo.days_remaining === "number" && tlsInfo.days_remaining < 21) {
    addFinding(findings, {
      severity: "warn",
      area: "ssl",
      title: "SSL certificate expires soon",
      detail: `${domain} certificate has ${tlsInfo.days_remaining} days left.`,
      recommendation: "Renew the certificate before it expires.",
    });
  }
  const headers = headerInfo.headers || {};
  if (headerInfo.ok && !headers.strict_transport_security) {
    addFinding(findings, {
      severity: "info",
      area: "website",
      title: "HSTS header missing",
      detail: "Website did not return Strict-Transport-Security.",
      recommendation: "Enable HSTS after confirming HTTPS is stable.",
    });
  }
  if (headerInfo.ok && !headers.content_security_policy) {
    addFinding(findings, {
      severity: "info",
      area: "website",
      title: "Content Security Policy missing",
      detail: "Website did not return a CSP header.",
      recommendation: "Add a conservative CSP to reduce browser injection risk.",
    });
  }
  if (headerInfo.ok && !headers.x_content_type_options) {
    addFinding(findings, {
      severity: "info",
      area: "website",
      title: "X-Content-Type-Options missing",
      detail: "Website did not return X-Content-Type-Options.",
      recommendation: "Set X-Content-Type-Options: nosniff.",
    });
  }
  return findings;
}

function executableFromWhere(name: string) {
  const command = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(command, [name], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
}

function directClamAvCandidates() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const localAppData = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const configuredHome = process.env.CLAMAV_HOME?.trim() || "";
  return [
    process.env.CLAMSCAN_PATH?.trim(),
    configuredHome ? path.join(configuredHome, "clamscan.exe") : "",
    path.join(programFiles, "ClamAV", "clamscan.exe"),
    path.join(programFilesX86, "ClamAV", "clamscan.exe"),
    "C:\\ProgramData\\chocolatey\\bin\\clamscan.exe",
    "C:\\tools\\ClamAV\\clamscan.exe",
    "C:\\ClamAV\\clamscan.exe",
    localAppData ? path.join(localAppData, "Programs", "ClamAV", "clamscan.exe") : "",
    home ? path.join(home, "scoop", "shims", "clamscan.exe") : "",
    home ? path.join(home, "scoop", "apps", "clamav", "current", "clamscan.exe") : "",
    home ? path.join(home, "Downloads", "clamav-1.5.2.win.x64", "clamav-1.5.2.win.x64", "clamscan.exe") : "",
  ].filter(Boolean) as string[];
}

function downloadedClamAvCandidates() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const downloads = home ? path.join(home, "Downloads") : "";
  if (!downloads || !existsSync(downloads)) return [];
  try {
    return readdirSync(downloads, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^clamav/i.test(entry.name))
      .flatMap((entry) => {
        const dir = path.join(downloads, entry.name);
        return [
          path.join(dir, "clamscan.exe"),
          path.join(dir, entry.name, "clamscan.exe"),
        ];
      });
  } catch {
    return [];
  }
}

function findClamAv() {
  for (const candidate of [...directClamAvCandidates(), ...downloadedClamAvCandidates()]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return executableFromWhere(process.platform === "win32" ? "clamscan.exe" : "clamscan");
}

function findWindowsDefender() {
  const configured = process.env.MPCMD_RUN_PATH?.trim();
  if (configured && existsSync(configured)) return configured;
  const commonRoot = "C:\\ProgramData\\Microsoft\\Windows Defender\\Platform";
  if (process.platform !== "win32" || !existsSync(commonRoot)) return null;
  try {
    const result = spawnSync("powershell", [
      "-NoProfile",
      "-Command",
      `Get-ChildItem '${commonRoot.replace(/'/g, "''")}' -Recurse -Filter MpCmdRun.exe -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName`,
    ], { encoding: "utf8", windowsHide: true, timeout: 5000 });
    if (result.status === 0) return result.stdout.trim() || null;
  } catch {
    return null;
  }
  return null;
}

function runProcess(command: string, args: string[]) {
  return new Promise<{ status: number | null; stdout: string; stderr: string; timed_out: boolean }>((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, PROCESS_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout: stdout.slice(-4000), stderr: stderr.slice(-4000), timed_out: timedOut });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ status: null, stdout, stderr: error.message, timed_out: timedOut });
    });
  });
}

async function antivirusScan(input: ExternalSecurityMonitorRequest) {
  const content = input.content || "";
  if (!content.trim()) {
    return {
      engine: findClamAv() ? "clamav" : findWindowsDefender() ? "windows_defender" : "none",
      available: Boolean(findClamAv() || findWindowsDefender()),
      scanned: false,
      clean: null,
      detail: "No content supplied for antivirus scan.",
      destructive_action: false,
    };
  }
  const clam = findClamAv();
  const defender = findWindowsDefender();
  const enginePath = clam || defender;
  if (!enginePath) {
    return {
      engine: "none",
      available: false,
      scanned: false,
      clean: null,
      detail: "No ClamAV or Windows Defender command-line scanner found.",
      destructive_action: false,
    };
  }
  const safeName = (input.filename || "phantomforce-scan.txt").replace(/[^a-z0-9_.-]+/gi, "_").slice(0, 80);
  const tempPath = path.join(tmpdir(), `phantomforce-security-${randomUUID()}-${safeName}`);
  await writeFile(tempPath, Buffer.from(content, "utf8"));
  try {
    const result = clam
      ? await runProcess(enginePath, ["--no-summary", tempPath])
      : await runProcess(enginePath, ["-Scan", "-ScanType", "3", "-File", tempPath, "-DisableRemediation"]);
    const output = `${result.stdout}\n${result.stderr}`;
    const infected = /FOUND|Threat/i.test(output) || result.status === 1;
    const scannerError = !infected && (result.timed_out || result.status !== 0);
    return {
      engine: clam ? "clamav" : "windows_defender",
      available: true,
      scanned: true,
      clean: infected ? false : scannerError ? null : true,
      status: result.status,
      timed_out: result.timed_out,
      detail: infected
        ? "Scanner reported a possible threat."
        : result.timed_out
          ? "Scanner timed out."
          : result.status === 0
            ? "Scanner completed clean."
            : `Scanner returned status ${result.status}; check antivirus database/setup.`,
      destructive_action: false,
    };
  } finally {
    await rm(tempPath, { force: true });
  }
}

async function hibpEmailChecks(emails: string[], enabled: boolean) {
  const key = process.env.HIBP_API_KEY?.trim() || process.env.HAVEIBEENPWNED_API_KEY?.trim();
  if (!key || !enabled) {
    return emails.map((email) => ({
      email,
      checked: false,
      configured: Boolean(key),
      breach_count: null,
      status: key ? "external calls disabled" : "HIBP API key missing",
    }));
  }
  return Promise.all(emails.map(async (email) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=true`, {
        headers: {
          "hibp-api-key": key,
          "User-Agent": "PhantomForce-SecurityMonitor/1.0",
        },
        signal: controller.signal,
      });
      if (response.status === 404) {
        return { email, checked: true, configured: true, breach_count: 0, status: "no public breach found" };
      }
      if (!response.ok) {
        return { email, checked: true, configured: true, breach_count: null, status: `HIBP returned ${response.status}` };
      }
      const body = await response.json().catch(() => []);
      return { email, checked: true, configured: true, breach_count: Array.isArray(body) ? body.length : null, status: "checked" };
    } catch (error) {
      return { email, checked: true, configured: true, breach_count: null, status: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  }));
}

export async function runExternalSecurityMonitor(input: ExternalSecurityMonitorRequest) {
  const domains = [...new Set((input.domains || []).map(normalizeDomain).filter(Boolean) as string[])].slice(0, MAX_DOMAIN_COUNT);
  const emails = [...new Set(input.emails || [])].slice(0, MAX_EMAIL_COUNT);
  const externalEnabled = input.enable_external_calls !== false;
  const findings: MonitorFinding[] = [];
  const domainResults = [];

  for (const domain of domains) {
    if (!externalEnabled) {
      domainResults.push({ domain, checked: false, reason: "external calls disabled" });
      continue;
    }
    const [dnsInfo, tlsInfo, headerInfo] = await Promise.all([
      dnsRecord(domain),
      tlsRecord(domain),
      httpHeaders(domain),
    ]);
    const domainFindings = evaluateDomain(domain, dnsInfo, tlsInfo, headerInfo);
    findings.push(...domainFindings);
    domainResults.push({ domain, checked: true, dns: dnsInfo, tls: tlsInfo, http: headerInfo, findings: domainFindings });
  }

  const localPreview = runSecurityScanPreview({
    label: input.label || "External monitor content snapshot",
    filename: input.filename,
    content: input.content,
    mode: "website",
  });
  findings.push(...localPreview.findings.slice(0, 10).map((finding): MonitorFinding => {
    const severity: MonitorSeverity = finding.severity === "critical" || finding.severity === "high" ? "warn" : "info";
    return {
      severity,
      area: finding.kind,
      title: finding.title,
      detail: finding.detail,
      recommendation: finding.recommendation,
    };
  }));

  const antivirus = await antivirusScan(input);
  if (antivirus.scanned && antivirus.clean === false) {
    findings.push({
      severity: "blocked",
      area: "antivirus",
      title: "Antivirus scan reported a possible threat",
      detail: antivirus.detail,
      recommendation: "Block this file or content until manually reviewed.",
    });
  }

  const hibp = await hibpEmailChecks(emails, externalEnabled);
  for (const result of hibp) {
    if (typeof result.breach_count === "number" && result.breach_count > 0) {
      findings.push({
        severity: "warn",
        area: "breach",
        title: "Email appears in public breach data",
        detail: `${result.email} returned ${result.breach_count} public breach hit${result.breach_count === 1 ? "" : "s"}.`,
        recommendation: "Rotate password, enable MFA, and review reused passwords.",
      });
    }
  }

  const blocked = findings.some((finding) => finding.severity === "blocked");
  const warnings = findings.filter((finding) => finding.severity === "warn").length;
  const verdict: ExternalMonitorHistory["verdict"] = blocked ? "blocked" : warnings ? "review" : "clean";
  const scannedAt = new Date().toISOString();
  const result = {
    ok: true,
    monitor_version: MONITOR_VERSION,
    scanned_at: scannedAt,
    label: input.label || "PhantomForce external monitor",
    summary: {
      verdict,
      domains_checked: domainResults.filter((domainResult) => "checked" in domainResult && domainResult.checked).length,
      emails_checked: hibp.filter((result) => result.checked).length,
      findings: findings.length,
      warnings,
      blocked: blocked ? 1 : 0,
    },
    connectors: connectorStatus(),
    domains: domainResults,
    email_breach: hibp,
    local_content_scan: localPreview.summary,
    antivirus,
    findings,
    safety_flags: {
      admin_only: true,
      external_calls_attempted: externalEnabled && (domains.length > 0 || (emails.length > 0 && envPresent("HIBP_API_KEY", "HAVEIBEENPWNED_API_KEY"))),
      destructive_action: false,
      upload_performed: false,
      deletes_files: false,
      plaintext_passwords_accepted: false,
      raw_credentials_returned: false,
    },
  };
  await writeExternalMonitorHistory({ last_run_at: scannedAt, verdict, findings_count: findings.length });
  return result;
}
