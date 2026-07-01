function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false";

const { app } = await import("../src/index.js");

type LoginResponse = {
  ok: boolean;
  token: string;
};

type SecurityScanResponse = {
  ok: boolean;
  read_only: true;
  result: {
    summary: {
      verdict: "clean" | "review" | "blocked";
      highest_severity: string;
      total_findings: number;
      malware_indicators: number;
      sensitive_data_findings: number;
      risky_file_findings: number;
      injection_risk_findings: number;
    };
    findings: Array<{
      kind: string;
      severity: string;
      title: string;
      evidence: string;
    }>;
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
  provider_called: false;
  external_api_call_performed: false;
  upload_performed: false;
  destructive_action: false;
};

type AutonomousSecurityResponse = {
  ok: boolean;
  autonomous: true;
  status:
    | "active"
    | "disabled"
    | "waiting"
    | "ran_this_month"
    | {
        status: "active" | "disabled" | "waiting" | "ran_this_month";
        cadence: "monthly";
        target_count: number;
        targets: Array<{
          target_label: string;
          summary: SecurityScanResponse["result"]["summary"];
        }>;
        safety_flags: {
          local_only: true;
          synthetic_targets_only: true;
          destructive_action: false;
          external_scan_provider_called: false;
          upload_performed: false;
          raw_content_stored: false;
        };
        password_health: {
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
          accounts: Array<{
            account_id: string;
            workspace: string;
            rotation_status: "baseline_needed";
            breach_check_status: "check_on_next_password_change";
          }>;
          safety_flags: {
            plaintext_password_stored: false;
            raw_password_logged: false;
            external_breach_provider_called: false;
            credential_printed: false;
          };
        };
      };
  protection_active?: boolean;
  details_redacted?: boolean;
  password_health?: {
    enabled: true;
    rotation_interval_days: 180;
    last_checked_at: string;
    breach_check_timing: "password_change_or_reset_only";
    details_redacted: true;
  };
};

try {
  const unauthStatus = await app.inject({
    method: "GET",
    url: "/phantom-ai/security/scan/status",
  });
  assert(unauthStatus.statusCode === 401, "Unauthenticated status should return 401.");

  const adminLogin = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId: "admin-jordan" }),
  });
  assert(adminLogin.statusCode === 200, "Admin demo login should succeed.");
  const adminToken = parseJson<LoginResponse>(adminLogin.payload).token;

  const clientLogin = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId: "client-sports-demo" }),
  });
  assert(clientLogin.statusCode === 200, "Client demo login should succeed.");
  const clientToken = parseJson<LoginResponse>(clientLogin.payload).token;

  const status = await app.inject({
    method: "GET",
    url: "/phantom-ai/security/scan/status",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(status.statusCode === 200, "Admin status should return 200.");
  const statusBody = parseJson<{ ok: boolean; scanner: { local_only: true; external_scan_provider: false } }>(
    status.payload,
  );
  assert(statusBody.ok === true, "Scanner status should be ok.");
  assert(statusBody.scanner.local_only === true, "Scanner must be local-only.");
  assert(statusBody.scanner.external_scan_provider === false, "Scanner must not use an external provider.");

  const autonomousStatus = await app.inject({
    method: "GET",
    url: "/phantom-ai/security/autonomous/status",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(autonomousStatus.statusCode === 200, "Admin autonomous status should return 200.");
  const autonomousBody = parseJson<AutonomousSecurityResponse>(autonomousStatus.payload);
  assert(autonomousBody.autonomous === true, "Autonomous status should identify monthly protection.");
  assert(typeof autonomousBody.status === "object", "Admin autonomous status should include details.");
  assert(autonomousBody.status.safety_flags.local_only === true, "Autonomous scanner must be local-only.");
  assert(
    autonomousBody.status.safety_flags.external_scan_provider_called === false,
    "Autonomous scanner must not call external scan providers.",
  );
  assert(autonomousBody.status.safety_flags.upload_performed === false, "Autonomous scanner must not upload.");
  assert(autonomousBody.status.safety_flags.raw_content_stored === false, "Autonomous scanner must not store raw content.");
  assert(autonomousBody.status.password_health.policy.rotation_interval_days === 180, "Password rotation should be 180 days.");
  assert(
    autonomousBody.status.password_health.policy.breach_check_timing === "password_change_or_reset_only",
    "Password breach checks should happen at password change/reset time.",
  );
  assert(
    autonomousBody.status.password_health.summary.total_admin_accounts >= 3,
    "Password health should cover owner/admin and business admin accounts.",
  );
  assert(
    autonomousBody.status.password_health.safety_flags.plaintext_password_stored === false,
    "Password health must not store plaintext passwords.",
  );
  assert(
    autonomousBody.status.password_health.safety_flags.external_breach_provider_called === false,
    "Monthly password health proof must not call external breach providers.",
  );

  const fakeSecret = ["sk", "or-v1-thisIsAFakeScannerTestKeyOnly1234567890"].join("-");
  const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
  const adminScan = await app.inject({
    method: "POST",
    url: "/phantom-ai/security/scan/preview",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    payload: JSON.stringify({
      label: "Admin website upload proof",
      filename: "client-intake.pdf.exe",
      mode: "upload",
      content: [
        eicar,
        `OPENROUTER_API_KEY=${fakeSecret}`,
        "coach@example.com",
        "<script>alert('xss')</script>",
      ].join("\n"),
    }),
  });
  assert(adminScan.statusCode === 200, "Admin scan should return 200.");
  const adminBody = parseJson<SecurityScanResponse>(adminScan.payload);
  const adminJson = JSON.stringify(adminBody);
  assert(adminBody.result.summary.verdict === "blocked", "Admin scan should block high-risk content.");
  assert(adminBody.result.summary.malware_indicators >= 1, "Admin scan should detect malware indicators.");
  assert(adminBody.result.summary.sensitive_data_findings >= 1, "Admin scan should detect sensitive data.");
  assert(adminBody.result.summary.risky_file_findings >= 1, "Admin scan should detect risky file names.");
  assert(adminBody.result.summary.injection_risk_findings >= 1, "Admin scan should detect injection risk.");
  assert(adminBody.result.safety_flags.local_only === true, "Scan result must stay local-only.");
  assert(adminBody.result.safety_flags.destructive_action === false, "Scan must not take destructive action.");
  assert(adminBody.result.safety_flags.external_scan_provider_called === false, "Scan must not call a provider.");
  assert(adminBody.result.safety_flags.upload_performed === false, "Scan must not upload.");
  assert(adminBody.provider_called === false, "Route must not call a provider.");
  assert(adminBody.external_api_call_performed === false, "Route must not call external APIs.");
  assert(!adminJson.includes(fakeSecret), "Response must not echo raw fake secrets.");

  const clientScan = await app.inject({
    method: "POST",
    url: "/phantom-ai/security/scan/preview",
    headers: {
      Authorization: `Bearer ${clientToken}`,
      "Content-Type": "application/json",
    },
    payload: JSON.stringify({
      label: "Client pasted website copy",
      mode: "website",
      content: "Safe homepage copy for a local team. Contact coach@example.com for details.",
    }),
  });
  assert(clientScan.statusCode === 200, "Client scan should be allowed for own pasted content.");
  const clientBody = parseJson<SecurityScanResponse>(clientScan.payload);
  assert(clientBody.result.summary.sensitive_data_findings >= 1, "Client scan should detect contact data.");
  assert(clientBody.result.safety_flags.raw_content_returned === false, "Client scan must not echo raw content.");

  const clientAutonomousStatus = await app.inject({
    method: "GET",
    url: "/phantom-ai/security/autonomous/status",
    headers: { Authorization: `Bearer ${clientToken}` },
  });
  assert(clientAutonomousStatus.statusCode === 200, "Client autonomous status should return 200.");
  const clientAutonomousBody = parseJson<AutonomousSecurityResponse>(clientAutonomousStatus.payload);
  assert(clientAutonomousBody.details_redacted === true, "Client autonomous details must be redacted.");
  assert(typeof clientAutonomousBody.status === "string", "Client autonomous status should be summary-only.");
  assert(clientAutonomousBody.password_health?.details_redacted === true, "Client password health details must be redacted.");
  assert(clientAutonomousBody.password_health?.rotation_interval_days === 180, "Client password reminder should use 180 days.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        unauthStatus: unauthStatus.statusCode,
        adminStatus: status.statusCode,
        adminScanStatus: adminScan.statusCode,
        clientScanStatus: clientScan.statusCode,
        autonomousStatus: typeof autonomousBody.status === "object" ? autonomousBody.status.status : autonomousBody.status,
        autonomousTargetCount: typeof autonomousBody.status === "object" ? autonomousBody.status.target_count : 0,
        passwordRotationDays:
          typeof autonomousBody.status === "object"
            ? autonomousBody.status.password_health.policy.rotation_interval_days
            : 0,
        passwordAdminAccounts:
          typeof autonomousBody.status === "object"
            ? autonomousBody.status.password_health.summary.total_admin_accounts
            : 0,
        clientAutonomousRedacted: clientAutonomousBody.details_redacted,
        clientPasswordHealthRedacted: clientAutonomousBody.password_health?.details_redacted,
        adminVerdict: adminBody.result.summary.verdict,
        adminFindings: adminBody.result.summary,
        clientVerdict: clientBody.result.summary.verdict,
        localOnly: adminBody.result.safety_flags.local_only,
        providerCalled: adminBody.provider_called,
        externalApiCallPerformed: adminBody.external_api_call_performed,
        uploadPerformed: adminBody.upload_performed,
        destructiveAction: adminBody.destructive_action,
        rawSecretEchoed: adminJson.includes(fakeSecret),
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
}
