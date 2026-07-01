import { Buffer } from "node:buffer";

import { z } from "zod";

const MAX_CONTENT_CHARS = 250_000;
const MAX_BASE64_CHARS = 600_000;
const SECURITY_SCANNER_VERSION = "2026.06.30-local-preview";

const severityRank = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
} as const;

export type SecurityFindingSeverity = keyof typeof severityRank;
export type SecurityFindingKind = "malware_indicator" | "sensitive_data" | "risky_file" | "injection_risk";

export type SecurityFinding = {
  id: string;
  kind: SecurityFindingKind;
  severity: SecurityFindingSeverity;
  title: string;
  detail: string;
  evidence: string;
  recommendation: string;
};

export type SecurityScanResult = {
  scanner_version: string;
  scanned_at: string;
  target_label: string;
  mode: "auto" | "website" | "upload" | "message" | "code";
  summary: {
    verdict: "clean" | "review" | "blocked";
    highest_severity: "none" | SecurityFindingSeverity;
    total_findings: number;
    malware_indicators: number;
    sensitive_data_findings: number;
    risky_file_findings: number;
    injection_risk_findings: number;
  };
  findings: SecurityFinding[];
  safety_flags: {
    local_only: true;
    destructive_action: false;
    quarantine_performed: false;
    file_deleted: false;
    external_scan_provider_called: false;
    upload_performed: false;
    credentials_printed: false;
    raw_content_returned: false;
  };
};

export const SecurityScanRequestSchema = z.object({
  label: z.string().trim().max(160).optional(),
  filename: z.string().trim().max(260).optional(),
  content: z.string().max(MAX_CONTENT_CHARS).optional(),
  content_base64: z.string().max(MAX_BASE64_CHARS).optional(),
  mode: z.enum(["auto", "website", "upload", "message", "code"]).default("auto").optional(),
});

type SecurityScanRequest = z.infer<typeof SecurityScanRequestSchema>;

type PatternRule = {
  kind: SecurityFindingKind;
  severity: SecurityFindingSeverity;
  title: string;
  detail: string;
  recommendation: string;
  pattern: RegExp;
};

const malwareRules: PatternRule[] = [
  {
    kind: "malware_indicator",
    severity: "critical",
    title: "EICAR antivirus test signature",
    detail: "The standard EICAR antivirus test string was found. Treat this as a malware-scanner validation hit.",
    recommendation: "Do not send this to a client. Use it only to prove scanners are working.",
    pattern: /X5O!P%@AP\[4\\PZX54\(P\^\)7CC\)7}\$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!\$H\+H\*/i,
  },
  {
    kind: "malware_indicator",
    severity: "high",
    title: "Encoded PowerShell execution pattern",
    detail: "The content contains a PowerShell encoded-command pattern often used to hide execution.",
    recommendation: "Block until the command is decoded and reviewed by an admin.",
    pattern: /\bpowershell(?:\.exe)?\b[^\n\r]{0,160}\s-(?:enc|encodedcommand)\b/i,
  },
  {
    kind: "malware_indicator",
    severity: "high",
    title: "Download-and-execute script pattern",
    detail: "The content appears to download remote code or commands at runtime.",
    recommendation: "Require admin review before accepting this file or snippet.",
    pattern: /\b(DownloadString|Invoke-WebRequest|Invoke-RestMethod|curl|wget)\b[^\n\r]{0,220}\b(http|https):\/\//i,
  },
  {
    kind: "malware_indicator",
    severity: "high",
    title: "Windows living-off-the-land execution tool",
    detail: "The content references Windows execution tools commonly abused by malware.",
    recommendation: "Review the exact command and source before running or storing it.",
    pattern: /\b(mshta|rundll32|regsvr32|certutil|bitsadmin|wscript|cscript)\b/i,
  },
  {
    kind: "injection_risk",
    severity: "medium",
    title: "Browser script injection pattern",
    detail: "The content contains script tags, javascript URLs, or inline event-handler patterns.",
    recommendation: "Sanitize before rendering in the dashboard or client website.",
    pattern: /(<\s*script\b|javascript:|onerror\s*=|onload\s*=|onclick\s*=)/i,
  },
  {
    kind: "injection_risk",
    severity: "medium",
    title: "SQL destructive statement pattern",
    detail: "The content contains a destructive SQL statement pattern.",
    recommendation: "Do not execute as SQL; review and sanitize if this came from a form field.",
    pattern: /\b(drop\s+table|truncate\s+table|delete\s+from)\b/i,
  },
];

const dataRules: PatternRule[] = [
  {
    kind: "sensitive_data",
    severity: "critical",
    title: "Private key block",
    detail: "A private-key block appears in the content.",
    recommendation: "Remove it from the website/app and rotate the key if it was exposed.",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  },
  {
    kind: "sensitive_data",
    severity: "critical",
    title: "OpenAI or project API key",
    detail: "A key shaped like an OpenAI project/API secret appears in the content.",
    recommendation: "Remove it from client-visible text and rotate the key if it was exposed.",
    pattern: /\bsk-(?:proj|live|test|or)[A-Za-z0-9_-]{12,}\b/i,
  },
  {
    kind: "sensitive_data",
    severity: "high",
    title: "Named API key assignment",
    detail: "A named API key or token assignment appears in the content.",
    recommendation: "Keep secrets in server environment variables or a vault, never in client-visible files.",
    pattern: /\b(?:api[_-]?key|secret|token|password|passwd|pwd|authorization)\b\s*[:=]\s*["']?[^"'\s]{6,}/i,
  },
  {
    kind: "sensitive_data",
    severity: "high",
    title: "AWS access key id",
    detail: "An AWS-style access key id appears in the content.",
    recommendation: "Remove it and rotate the credential if it was exposed.",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    kind: "sensitive_data",
    severity: "high",
    title: "GitHub token",
    detail: "A GitHub token pattern appears in the content.",
    recommendation: "Remove it and revoke/rotate the token before client exposure.",
    pattern: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/,
  },
  {
    kind: "sensitive_data",
    severity: "high",
    title: "Bearer token",
    detail: "A bearer token appears in the content.",
    recommendation: "Remove it from logs, docs, and client-visible surfaces.",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i,
  },
  {
    kind: "sensitive_data",
    severity: "high",
    title: "Social Security number",
    detail: "An SSN-shaped value appears in the content.",
    recommendation: "Do not store or show this in PhantomForce unless a compliance workflow exists.",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/,
  },
  {
    kind: "sensitive_data",
    severity: "low",
    title: "Email address",
    detail: "An email address appears in the content.",
    recommendation: "Only show this where the signed-in user is allowed to see contact data.",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  },
  {
    kind: "sensitive_data",
    severity: "low",
    title: "Phone number",
    detail: "A phone-number-shaped value appears in the content.",
    recommendation: "Treat as client/contact data and avoid public display.",
    pattern: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/,
  },
];

const riskyExtensions = new Set([
  ".bat",
  ".cmd",
  ".com",
  ".dll",
  ".exe",
  ".hta",
  ".jar",
  ".js",
  ".jse",
  ".msi",
  ".ps1",
  ".scr",
  ".vbe",
  ".vbs",
  ".wsf",
]);

function normalizeMode(mode: SecurityScanRequest["mode"]) {
  return mode ?? "auto";
}

function extensionFromFilename(filename: string | undefined) {
  const match = filename?.toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match?.[1] ?? null;
}

function decodeBase64(value: string | undefined) {
  if (!value) return null;

  try {
    return Buffer.from(value, "base64");
  } catch {
    return null;
  }
}

function redactedEvidence(value: string) {
  const compact = value.replace(/\s+/g, " ").trim().slice(0, 160);

  return compact
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----/gi, "-----BEGIN [REDACTED] PRIVATE KEY-----")
    .replace(/\bsk-(?:proj|live|test|or)[A-Za-z0-9_-]{8,}\b/gi, (token) => `${token.slice(0, 7)}...[redacted]`)
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "AKIA...[redacted]")
    .replace(/\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{12,}\b/g, "[github-token-redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "Bearer [redacted]")
    .replace(
      /\b(?:api[_-]?key|secret|token|password|passwd|pwd|authorization)\b\s*[:=]\s*["']?[^"'\s]{4,}/gi,
      (match) => match.replace(/[:=]\s*["']?[^"'\s]{4,}/, ": [redacted]"),
    )
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[ssn-redacted]")
    .replace(/\b(\d[ -]?){13,19}\b/g, "[number-redacted]");
}

function makeFindingId(prefix: string, index: number) {
  return `${prefix}-${String(index + 1).padStart(2, "0")}`;
}

function addPatternFindings(findings: SecurityFinding[], text: string, rules: PatternRule[], prefix: string) {
  for (const rule of rules) {
    const match = text.match(rule.pattern);

    if (!match?.[0]) continue;

    findings.push({
      id: makeFindingId(prefix, findings.length),
      kind: rule.kind,
      severity: rule.severity,
      title: rule.title,
      detail: rule.detail,
      evidence: redactedEvidence(match[0]),
      recommendation: rule.recommendation,
    });
  }
}

function luhnValid(value: string) {
  const digits = value.replace(/\D/g, "");

  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let doubleDigit = false;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);

    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }

    sum += digit;
    doubleDigit = !doubleDigit;
  }

  return sum % 10 === 0;
}

function addCreditCardFinding(findings: SecurityFinding[], text: string) {
  const candidates = text.match(/\b(?:\d[ -]?){13,19}\b/g) ?? [];
  const validCandidate = candidates.find((candidate) => luhnValid(candidate));

  if (!validCandidate) return;

  findings.push({
    id: makeFindingId("data", findings.length),
    kind: "sensitive_data",
    severity: "high",
    title: "Payment-card-shaped number",
    detail: "A Luhn-valid card-number-shaped value appears in the content.",
    evidence: redactedEvidence(validCandidate),
    recommendation: "Remove it from the dashboard and use a payment provider token instead.",
  });
}

function addFileFindings(findings: SecurityFinding[], filename: string | undefined, bytes: Buffer | null) {
  const extension = extensionFromFilename(filename);

  if (extension && riskyExtensions.has(extension)) {
    findings.push({
      id: makeFindingId("file", findings.length),
      kind: "risky_file",
      severity: "high",
      title: "Executable or script file extension",
      detail: `The filename ends with ${extension}, which should not be accepted as a normal client upload without review.`,
      evidence: redactedEvidence(filename ?? extension),
      recommendation: "Block or route to admin review before any client-facing use.",
    });
  }

  if (filename && /\.[a-z0-9]{2,6}\.(exe|scr|js|vbs|ps1|bat|cmd)$/i.test(filename)) {
    findings.push({
      id: makeFindingId("file", findings.length),
      kind: "risky_file",
      severity: "high",
      title: "Double-extension file name",
      detail: "The filename uses a document-like extension followed by an executable/script extension.",
      evidence: redactedEvidence(filename),
      recommendation: "Block or require admin review. Double-extension files are often used to trick users.",
    });
  }

  if (bytes && bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
    findings.push({
      id: makeFindingId("file", findings.length),
      kind: "risky_file",
      severity: "high",
      title: "Windows executable header",
      detail: "The uploaded bytes begin with an MZ executable header.",
      evidence: "MZ header",
      recommendation: "Do not render or distribute this from the client/admin website without separate malware analysis.",
    });
  }
}

function summarize(findings: SecurityFinding[]): SecurityScanResult["summary"] {
  const highest = findings.reduce<SecurityFindingSeverity | "none">((current, finding) => {
    if (current === "none") return finding.severity;
    return severityRank[finding.severity] > severityRank[current] ? finding.severity : current;
  }, "none");
  const blocked = highest === "critical" || highest === "high";

  return {
    verdict: findings.length === 0 ? "clean" : blocked ? "blocked" : "review",
    highest_severity: highest,
    total_findings: findings.length,
    malware_indicators: findings.filter((finding) => finding.kind === "malware_indicator").length,
    sensitive_data_findings: findings.filter((finding) => finding.kind === "sensitive_data").length,
    risky_file_findings: findings.filter((finding) => finding.kind === "risky_file").length,
    injection_risk_findings: findings.filter((finding) => finding.kind === "injection_risk").length,
  };
}

export function getSecurityScannerStatus() {
  return {
    scanner_version: SECURITY_SCANNER_VERSION,
    status: "available",
    local_only: true,
    destructive_actions: false,
    quarantine_supported: false,
    external_scan_provider: false,
    upload_performed: false,
    max_content_chars: MAX_CONTENT_CHARS,
    max_content_base64_chars: MAX_BASE64_CHARS,
    scanners: [
      "EICAR/test-malware signature detection",
      "Suspicious script and download/execution pattern detection",
      "Executable/double-extension upload checks",
      "Secret/API-key/private-key detection",
      "PII/contact/payment-card-shaped data detection",
      "Basic browser/SQL injection-risk detection",
    ],
  };
}

export function runSecurityScanPreview(input: SecurityScanRequest): SecurityScanResult {
  const bytes = decodeBase64(input.content_base64);
  const decodedText = bytes ? bytes.toString("utf8") : "";
  const text = [input.content ?? "", decodedText].filter(Boolean).join("\n");
  const findings: SecurityFinding[] = [];

  addFileFindings(findings, input.filename, bytes);
  addPatternFindings(findings, text, malwareRules, "malware");
  addPatternFindings(findings, text, dataRules, "data");
  addCreditCardFinding(findings, text);

  const targetLabel = input.label?.trim() || input.filename?.trim() || "Untitled scan";

  return {
    scanner_version: SECURITY_SCANNER_VERSION,
    scanned_at: new Date().toISOString(),
    target_label: targetLabel.slice(0, 160),
    mode: normalizeMode(input.mode),
    summary: summarize(findings),
    findings,
    safety_flags: {
      local_only: true,
      destructive_action: false,
      quarantine_performed: false,
      file_deleted: false,
      external_scan_provider_called: false,
      upload_performed: false,
      credentials_printed: false,
      raw_content_returned: false,
    },
  };
}
