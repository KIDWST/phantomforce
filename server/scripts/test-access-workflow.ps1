$ErrorActionPreference = "Stop"

$baseUrl = if ($env:PHANTOMFORCE_SERVER_URL) {
  $env:PHANTOMFORCE_SERVER_URL.TrimEnd("/")
} else {
  "http://127.0.0.1:5190"
}
$expectedRepositoryDriver = if ($env:PHANTOMFORCE_EXPECT_REPOSITORY_DRIVER) {
  $env:PHANTOMFORCE_EXPECT_REPOSITORY_DRIVER
} else {
  "json-file"
}
$expectedPrismaWriteMode = if ($env:PHANTOMFORCE_EXPECT_PRISMA_WRITE_MODE) {
  $env:PHANTOMFORCE_EXPECT_PRISMA_WRITE_MODE
} else {
  "disabled"
}

$noSessionHeaders = @{}

function Invoke-Json {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $false)][string]$Method = "Get",
    [Parameter(Mandatory = $false)]$Body,
    [Parameter(Mandatory = $false)][hashtable]$Headers = $adminHeaders
  )

  $parameters = @{
    Uri = $Uri
    Method = $Method
    ContentType = "application/json"
    Headers = $Headers
  }

  if ($null -ne $Body) {
    $parameters.Body = ($Body | ConvertTo-Json -Compress)
  }

  Invoke-RestMethod @parameters
}

function New-AuthHeaders {
  param(
    [Parameter(Mandatory = $true)][string]$SessionId
  )

  $login = Invoke-Json `
    -Uri "$baseUrl/auth/demo-login" `
    -Method "Post" `
    -Headers $noSessionHeaders `
    -Body @{ sessionId = $SessionId }

  Assert-True ($login.ok -eq $true) "Demo login should issue a signed token."
  Assert-True ($login.tokenType -eq "Bearer") "Demo login should issue a bearer token."
  Assert-True ($login.token.Length -gt 20) "Demo login token should not be empty."

  return @{ "Authorization" = "Bearer $($login.token)" }
}

function Assert-True {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Message
  )

  if (-not $Condition) {
    throw "ASSERTION FAILED: $Message"
  }
}

function Assert-HttpError {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Call,
    [Parameter(Mandatory = $true)][int]$StatusCode,
    [Parameter(Mandatory = $true)][string]$Message
  )

  try {
    & $Call | Out-Null
  } catch {
    $actual = $_.Exception.Response.StatusCode.value__
    if ($actual -eq $StatusCode) {
      return
    }

    throw "ASSERTION FAILED: $Message Expected $StatusCode, got $actual"
  }

  throw "ASSERTION FAILED: $Message"
}

$script:auditContentAssertions = 0

function Assert-AuditContent {
  param(
    [Parameter(Mandatory = $true)]$Event,
    [Parameter(Mandatory = $true)][hashtable]$Expected,
    [Parameter(Mandatory = $true)][string]$Message
  )

  Assert-True ($null -ne $Event) "$Message should return an audit event."

  foreach ($key in $Expected.Keys) {
    $property = $Event.PSObject.Properties[$key]
    Assert-True ($null -ne $property) "$Message should include audit field '$key'."
    $actual = $property.Value
    $expectedValue = $Expected[$key]
    Assert-True ($actual -eq $expectedValue) "$Message audit field '$key' expected '$expectedValue', got '$actual'."
  }

  $script:auditContentAssertions += 1
}

function Assert-WorkflowAuditContent {
  param(
    [Parameter(Mandatory = $true)]$Workflow,
    [Parameter(Mandatory = $true)][string]$EventType,
    [Parameter(Mandatory = $true)][string]$ActionId,
    [Parameter(Mandatory = $true)][string]$ApprovalId,
    [Parameter(Mandatory = $true)][hashtable]$Expected,
    [Parameter(Mandatory = $true)][string]$Message
  )

  $matches = @(
    $Workflow.auditEvents | Where-Object {
      $_.eventType -eq $EventType -and
      $_.actionId -eq $ActionId -and
      $_.approvalId -eq $ApprovalId
    }
  )

  Assert-True ($matches.Count -eq 1) "$Message should persist exactly one matching audit event."
  Assert-AuditContent $matches[0] $Expected $Message
}

$health = Invoke-Json -Uri "$baseUrl/health"
Assert-True ($health.ok -eq $true) "Server health should be ok."

$sessions = Invoke-Json -Uri "$baseUrl/sessions" -Headers $noSessionHeaders
Assert-True ($sessions.ok -eq $true) "Sessions endpoint should list demo sessions."
Assert-True ($sessions.auth.tokenType -eq "Bearer") "Sessions endpoint should advertise bearer auth."
Assert-True ($sessions.auth.authProvider -eq "demo") "Local sessions endpoint should report demo auth provider."
Assert-True ($sessions.auth.demoAuthEnabled -eq $true) "Demo auth should be enabled for local workflow tests."
Assert-True ($sessions.auth.productionMode -eq $false) "Local workflow tests should not run in production auth mode."
Assert-True ($sessions.auth.productionReady -eq $false) "Demo auth should not report production readiness."
Assert-True ($sessions.auth.legacyHeaderAccepted -eq $false) "Unsigned session header should be disabled by default."
Assert-True (@($sessions.sessions | Where-Object { $_.id -eq "admin-jordan" }).Count -eq 1) "Admin demo session should exist."

$adminHeaders = New-AuthHeaders "admin-jordan"
$sportsClientHeaders = New-AuthHeaders "client-sports-demo"
$chicagoClientHeaders = New-AuthHeaders "client-chicagoshots"

Assert-HttpError `
  -StatusCode 401 `
  -Message "Forged legacy session header should not authenticate." `
  -Call { Invoke-Json -Uri "$baseUrl/session" -Headers @{ "x-phantomforce-session" = "admin-jordan" } }

Assert-HttpError `
  -StatusCode 401 `
  -Message "Invalid bearer token should not authenticate." `
  -Call { Invoke-Json -Uri "$baseUrl/session" -Headers @{ "Authorization" = "Bearer not-a-real-token" } }

Assert-HttpError `
  -StatusCode 401 `
  -Message "Workspace access should require a session." `
  -Call { Invoke-Json -Uri "$baseUrl/client-workspaces/client-sports-demo" -Headers $noSessionHeaders }

$adminSession = Invoke-Json -Uri "$baseUrl/session"
Assert-True ($adminSession.session.canManageAccess -eq $true) "Admin session should manage access."

$sportsClientWorkspace = Invoke-Json -Uri "$baseUrl/client-workspaces/client-sports-demo" -Headers $sportsClientHeaders
Assert-True ($sportsClientWorkspace.ok -eq $true) "Client should view its own workspace."

$sportsClientAccess = Invoke-Json -Uri "$baseUrl/client-access" -Headers $sportsClientHeaders
Assert-True ($sportsClientAccess.records.Count -eq 1) "Client access list should be scoped to one client."
Assert-True ($sportsClientAccess.records[0].id -eq "client-sports-demo") "Client access list should return the caller's workspace."

Assert-HttpError `
  -StatusCode 403 `
  -Message "Client should not view another client workspace." `
  -Call { Invoke-Json -Uri "$baseUrl/client-workspaces/client-sports-demo" -Headers $chicagoClientHeaders }

Assert-HttpError `
  -StatusCode 403 `
  -Message "Client should not read the admin access workflow." `
  -Call { Invoke-Json -Uri "$baseUrl/client-access-workflow" -Headers $sportsClientHeaders }

Assert-HttpError `
  -StatusCode 403 `
  -Message "Client should not read Pangolin dry-run route plans." `
  -Call { Invoke-Json -Uri "$baseUrl/pangolin/reconcile/dry-run" -Headers $sportsClientHeaders }

Assert-HttpError `
  -StatusCode 403 `
  -Message "Client should not read Pangolin live status." `
  -Call { Invoke-Json -Uri "$baseUrl/pangolin/status/read-only" -Headers $sportsClientHeaders }

Assert-HttpError `
  -StatusCode 403 `
  -Message "Client should not read production readiness details." `
  -Call { Invoke-Json -Uri "$baseUrl/readiness" -Headers $sportsClientHeaders }

Assert-HttpError `
  -StatusCode 403 `
  -Message "Client should not read billing source-of-truth status." `
  -Call { Invoke-Json -Uri "$baseUrl/billing/status/read-only" -Headers $sportsClientHeaders }

Assert-HttpError `
  -StatusCode 403 `
  -Message "Client should not propose access changes." `
  -Call {
    Invoke-Json `
      -Uri "$baseUrl/client-access/client-sports-demo/status/propose" `
      -Method "Post" `
      -Headers $sportsClientHeaders `
      -Body @{
        accessStatus = "revoked"
        reason = "client should not self-revoke"
        proposedBy = "Client"
      }
  }

$clientProvisioningBody = @{
  clientId = "client-provisioning-client-attempt"
  business = "Client Attempt Demo"
  owner = "Client Owner"
  plan = "$1,250/mo Ops Support"
  source = "manual"
  winStatus = "signed_agreement"
  paymentStatus = "due"
  modules = @("Command", "Calendar", "Tasks")
  reason = "client attempted self-provisioning"
}

Assert-HttpError `
  -StatusCode 403 `
  -Message "Client should not dry-run client provisioning." `
  -Call {
    Invoke-Json `
      -Uri "$baseUrl/client-provisioning/dry-run" `
      -Method "Post" `
      -Headers $sportsClientHeaders `
      -Body $clientProvisioningBody
  }

Assert-HttpError `
  -StatusCode 403 `
  -Message "Client should not propose client provisioning." `
  -Call {
    Invoke-Json `
      -Uri "$baseUrl/client-provisioning/propose" `
      -Method "Post" `
      -Headers $sportsClientHeaders `
      -Body $clientProvisioningBody
  }

$activeWorkspace = Invoke-Json -Uri "$baseUrl/client-workspaces/client-sports-demo"
Assert-True ($activeWorkspace.ok -eq $true) "Active workspace should be accessible."
Assert-True ($activeWorkspace.workspace.mode -eq "full") "Active workspace should have full mode."

$pangolinPlan = Invoke-Json -Uri "$baseUrl/pangolin/reconcile/dry-run"
Assert-True ($pangolinPlan.dryRun -eq $true) "Pangolin reconciler should run in dry-run mode."
Assert-True ($pangolinPlan.provider -eq "Pangolin") "Pangolin reconciler should identify the provider."
Assert-True ($pangolinPlan.liveChangesAllowed -eq $false) "Pangolin dry-run must not allow live changes."
Assert-True ($pangolinPlan.approvalRequiredForLiveChanges -eq $true) "Pangolin live changes should require approval."
$pangolinStatus = Invoke-Json -Uri "$baseUrl/pangolin/status/read-only"
Assert-True ($pangolinStatus.status.readOnly -eq $true) "Pangolin status check should be read-only."
Assert-True ($pangolinStatus.status.liveChangesAllowed -eq $false) "Pangolin status check must not allow live changes."
if (-not $env:PANGOLIN_READONLY_BASE_URL) {
  Assert-True ($pangolinStatus.status.configured -eq $false) "Pangolin status should be unconfigured without base URL."
  Assert-True ($pangolinStatus.status.status -eq "unconfigured") "Pangolin status should report unconfigured without base URL."
}

$billingStatus = Invoke-Json -Uri "$baseUrl/billing/status/read-only"
Assert-True ($billingStatus.ok -eq $true) "Admin should read billing source-of-truth status."
Assert-True ($billingStatus.status.provider -eq "manual-json-file") "Billing provider should be the local manual JSON provider."
Assert-True ($billingStatus.status.sourceOfTruth -eq "local-manual-provider") "Billing source of truth should be local manual provider."
Assert-True ($billingStatus.status.readOnly -eq $true) "Billing status endpoint should be read-only."
Assert-True ($billingStatus.status.productionReady -eq $false) "Local manual billing should not be production-ready."
Assert-True ($billingStatus.status.liveWebhooksAllowed -eq $false) "Local manual billing should not allow live webhooks."
Assert-True (($billingStatus.status.supportedPaymentStatuses -contains "paid")) "Billing status should support paid payment status."
Assert-True (($billingStatus.status.supportedPaymentStatuses -contains "due")) "Billing status should support due payment status."
Assert-True (($billingStatus.status.supportedPaymentStatuses -contains "failed")) "Billing status should support failed payment status."

$readiness = Invoke-Json -Uri "$baseUrl/readiness"
Assert-True ($readiness.ok -eq $true) "Admin should read production readiness."
Assert-True ($readiness.report.localDemoReady -eq $true) "Readiness should report local demo ready."
Assert-True ($readiness.report.productionReady -eq $false) "Readiness should not report production ready in local demo mode."
Assert-True (@($readiness.report.gates | Where-Object { $_.id -eq "local_access_spine" -and $_.status -eq "ready" }).Count -eq 1) "Readiness should mark local access spine ready."
Assert-True (@($readiness.report.gates | Where-Object { $_.id -eq "audit_content_parity" -and $_.status -eq "ready" }).Count -eq 1) "Readiness should mark audit content and driver parity ready."
Assert-True (@($readiness.report.gates | Where-Object { $_.id -eq "calendar_connector_boundary" -and $_.status -eq "ready" }).Count -eq 1) "Readiness should mark Calendar connector boundary ready."
Assert-True (@($readiness.report.gates | Where-Object { $_.id -eq "billing_source_of_truth" -and $_.status -eq "needs_config" }).Count -eq 1) "Readiness should require a production billing source of truth."
Assert-True (@($readiness.report.gates | Where-Object { $_.id -eq "production_auth" -and $_.status -eq "blocked" }).Count -eq 1) "Readiness should block production auth until implemented."
Assert-True (@($readiness.report.gates | Where-Object { $_.id -eq "live_oauth_connectors" -and $_.status -eq "needs_config" }).Count -eq 1) "Readiness should require live OAuth connector configuration."
if ($expectedRepositoryDriver -eq "json-file") {
  Assert-True (@($readiness.report.gates | Where-Object { $_.id -eq "production_postgres" -and $_.status -eq "needs_config" }).Count -eq 1) "Readiness should require production Postgres when JSON fallback is active."
}

Assert-HttpError `
  -StatusCode 403 `
  -Message "Client should not create local workflow recovery snapshots." `
  -Call {
    Invoke-Json `
      -Uri "$baseUrl/client-access-workflow/snapshot" `
      -Method "Post" `
      -Headers $sportsClientHeaders `
      -Body @{ label = "client-attempt" }
  }

$sportsRoutePlan = @($pangolinPlan.plans | Where-Object { $_.clientId -eq "client-sports-demo" })[0]
$revokedRoutePlan = @($pangolinPlan.plans | Where-Object { $_.clientId -eq "client-past-due" })[0]
Assert-True ($sportsRoutePlan.desiredState -eq "enabled") "Active paid client should map to enabled Pangolin route."
Assert-True ($sportsRoutePlan.gatewayEnforcement -eq "allow_route") "Active paid client should keep the Pangolin route reachable."
Assert-True ($sportsRoutePlan.appEnforcement -eq "full") "Active paid client should enforce full access in PhantomForce handlers."
Assert-True ($revokedRoutePlan.desiredState -eq "disabled") "Revoked client should map to disabled Pangolin route."
Assert-True ($revokedRoutePlan.gatewayEnforcement -eq "disable_route") "Revoked client should disable Pangolin route reachability."
Assert-True ($revokedRoutePlan.appEnforcement -eq "blocked") "Revoked client should be blocked by PhantomForce handlers."

$unpaidProvisioningBody = @{
  clientId = "client-provisioning-unpaid-demo"
  business = "Provisioned Unpaid Demo"
  owner = "New Client Owner"
  plan = "$1,250/mo Ops Support"
  source = "nexprospex"
  sourceRecordId = "nxp-unpaid-demo"
  winStatus = "signed_agreement"
  paymentStatus = "due"
  modules = @("Command", "Calendar", "Tasks")
  reason = "signed agreement before first payment"
}

$unpaidDryRun = Invoke-Json `
  -Uri "$baseUrl/client-provisioning/dry-run" `
  -Method "Post" `
  -Body $unpaidProvisioningBody
Assert-True ($unpaidDryRun.plan.billingProvider -eq "manual-json-file") "Provisioning should use the local manual billing provider."
Assert-True ($unpaidDryRun.plan.billingSourceOfTruth -eq "local-manual-provider") "Provisioning should identify the billing source of truth."
Assert-True ($unpaidDryRun.plan.accessStatus -eq "revoked") "Signed but unpaid clients should be blocked until payment."
Assert-True ($unpaidDryRun.plan.workspaceAllowedAfterApproval -eq $false) "Unpaid provisioning should fail closed."

$workflowBeforeMalformedProvisioning = Invoke-Json -Uri "$baseUrl/client-access-workflow"
Assert-HttpError `
  -StatusCode 400 `
  -Message "Malformed billing status should be rejected before an action or audit event is created." `
  -Call {
    Invoke-Json `
      -Uri "$baseUrl/client-provisioning/propose" `
      -Method "Post" `
      -Body @{
        clientId = "client-malformed-billing-demo"
        business = "Malformed Billing Demo"
        owner = "Client Owner"
        plan = "$1,250/mo Ops Support"
        source = "nexprospex"
        sourceRecordId = "nxp-malformed-billing"
        winStatus = "payment_received"
        paymentStatus = "unknown"
        modules = @("Command", "Calendar")
        reason = "malformed billing should fail closed"
      }
  }
$workflowAfterMalformedProvisioning = Invoke-Json -Uri "$baseUrl/client-access-workflow"
Assert-True ($workflowAfterMalformedProvisioning.actions.Count -eq $workflowBeforeMalformedProvisioning.actions.Count) "Malformed billing should not create an action."
Assert-True ($workflowAfterMalformedProvisioning.approvals.Count -eq $workflowBeforeMalformedProvisioning.approvals.Count) "Malformed billing should not create an approval."
Assert-True ($workflowAfterMalformedProvisioning.auditEvents.Count -eq $workflowBeforeMalformedProvisioning.auditEvents.Count) "Malformed billing should not create an audit event."

Assert-HttpError `
  -StatusCode 400 `
  -Message "Provisioning with no modules should be rejected before approval." `
  -Call {
    Invoke-Json `
      -Uri "$baseUrl/client-provisioning/propose" `
      -Method "Post" `
      -Body @{
        clientId = "client-empty-modules-demo"
        business = "Empty Modules Demo"
        owner = "Client Owner"
        plan = "$1,250/mo Ops Support"
        source = "manual"
        winStatus = "payment_received"
        paymentStatus = "paid"
        modules = @()
        reason = "empty module set should fail closed"
      }
  }
$workflowAfterEmptyModulesProvisioning = Invoke-Json -Uri "$baseUrl/client-access-workflow"
Assert-True ($workflowAfterEmptyModulesProvisioning.actions.Count -eq $workflowAfterMalformedProvisioning.actions.Count) "Empty modules should not create an action."
Assert-True ($workflowAfterEmptyModulesProvisioning.approvals.Count -eq $workflowAfterMalformedProvisioning.approvals.Count) "Empty modules should not create an approval."
Assert-True ($workflowAfterEmptyModulesProvisioning.auditEvents.Count -eq $workflowAfterMalformedProvisioning.auditEvents.Count) "Empty modules should not create an audit event."

$paidProvisioningBody = @{
  clientId = "client-provisioning-paid-demo"
  business = "Provisioned Paid Demo"
  owner = "New Paid Owner"
  plan = "$2,000 Team Media Day"
  source = "nexprospex"
  sourceRecordId = "nxp-paid-demo"
  winStatus = "payment_received"
  paymentStatus = "paid"
  modules = @("Command", "Calendar", "Tasks", "Approvals", "Contacts")
  reason = "first payment received from CRM close"
}

$paidProvisionProposal = Invoke-Json `
  -Uri "$baseUrl/client-provisioning/propose" `
  -Method "Post" `
  -Body $paidProvisioningBody
Assert-True ($paidProvisionProposal.action.type -eq "client.provision") "Provisioning should create a client.provision action."
Assert-True ($paidProvisionProposal.action.status -eq "pending_approval") "Provisioning action should start pending."
Assert-True ($paidProvisionProposal.action.accessStatus -eq "active") "Paid provisioning should request active access."
Assert-True ($paidProvisionProposal.action.billingProvider -eq "manual-json-file") "Provisioning action should persist the billing provider."
Assert-True ($paidProvisionProposal.action.billingSourceOfTruth -eq "local-manual-provider") "Provisioning action should persist the billing source of truth."
Assert-True ($paidProvisionProposal.approval.status -eq "pending") "Provisioning approval should start pending."
Assert-AuditContent $paidProvisionProposal.auditEvent @{
  eventType = "client.provision.proposed"
  actor = "Jordan"
  clientId = "client-provisioning-paid-demo"
  business = "Provisioned Paid Demo"
  nextStatus = "active"
  paymentStatus = "paid"
  source = "nexprospex"
  billingProvider = "manual-json-file"
  billingSourceOfTruth = "local-manual-provider"
  reason = "first payment received from CRM close"
  actionId = $paidProvisionProposal.action.id
  approvalId = $paidProvisionProposal.approval.id
} "Paid provisioning proposal"

$paidProvisionDecision = Invoke-Json `
  -Uri "$baseUrl/client-access-approvals/$($paidProvisionProposal.approval.id)/decision" `
  -Method "Post" `
  -Body @{
    decision = "approve"
    decidedBy = "Jordan"
    reason = "approved paid provisioning workflow"
  }
Assert-True ($paidProvisionDecision.action.status -eq "executed") "Approved paid provisioning should execute."
Assert-True ($paidProvisionDecision.record.id -eq "client-provisioning-paid-demo") "Paid provisioning should create the requested client record."
Assert-True ($paidProvisionDecision.record.paymentStatus -eq "paid") "Paid provisioning should persist paid status."
Assert-True ($paidProvisionDecision.record.accessStatus -eq "active") "Paid provisioning should persist active access."
Assert-True (($paidProvisionDecision.record.modules -contains "Calendar")) "Paid provisioning should persist module entitlements."
Assert-True ($paidProvisionDecision.record.connectorCredentials.calendar.credentialRef -eq "local-demo:client-provisioning-paid-demo:calendar") "Paid provisioning should create a workspace calendar credential reference."
Assert-AuditContent $paidProvisionDecision.auditEvent @{
  eventType = "client.provision.approved"
  actor = "Jordan"
  clientId = "client-provisioning-paid-demo"
  business = "Provisioned Paid Demo"
  nextStatus = "active"
  paymentStatus = "paid"
  source = "nexprospex"
  billingProvider = "manual-json-file"
  billingSourceOfTruth = "local-manual-provider"
  reason = "approved paid provisioning workflow"
  actionId = $paidProvisionProposal.action.id
  approvalId = $paidProvisionProposal.approval.id
} "Paid provisioning approval"

$paidProvisionWorkspace = Invoke-Json -Uri "$baseUrl/client-workspaces/client-provisioning-paid-demo"
Assert-True ($paidProvisionWorkspace.workspace.mode -eq "full") "Paid provisioned workspace should load in full mode."

$paidProvisionIdempotencyProposal = Invoke-Json `
  -Uri "$baseUrl/client-provisioning/propose" `
  -Method "Post" `
  -Body $paidProvisioningBody
Assert-True ($paidProvisionIdempotencyProposal.action.type -eq "client.provision") "Repeated paid provisioning should still require approval."
Assert-True ($paidProvisionIdempotencyProposal.action.previousExists -eq $true) "Repeated paid provisioning should update the existing client instead of creating a new workspace."
Assert-AuditContent $paidProvisionIdempotencyProposal.auditEvent @{
  eventType = "client.provision.proposed"
  actor = "Jordan"
  clientId = "client-provisioning-paid-demo"
  business = "Provisioned Paid Demo"
  nextStatus = "active"
  paymentStatus = "paid"
  source = "nexprospex"
  billingProvider = "manual-json-file"
  billingSourceOfTruth = "local-manual-provider"
  reason = "first payment received from CRM close"
  actionId = $paidProvisionIdempotencyProposal.action.id
  approvalId = $paidProvisionIdempotencyProposal.approval.id
} "Repeated paid provisioning proposal"

$paidProvisionIdempotencyDecision = Invoke-Json `
  -Uri "$baseUrl/client-access-approvals/$($paidProvisionIdempotencyProposal.approval.id)/decision" `
  -Method "Post" `
  -Body @{
    decision = "approve"
    decidedBy = "Jordan"
    reason = "approved repeated paid provisioning idempotency check"
  }
Assert-True ($paidProvisionIdempotencyDecision.action.status -eq "executed") "Repeated paid provisioning should execute as an update."
Assert-True ($paidProvisionIdempotencyDecision.record.id -eq "client-provisioning-paid-demo") "Repeated paid provisioning should keep the same client id."
Assert-True ($paidProvisionIdempotencyDecision.record.accessStatus -eq "active") "Repeated paid provisioning should preserve active access."
Assert-AuditContent $paidProvisionIdempotencyDecision.auditEvent @{
  eventType = "client.provision.approved"
  actor = "Jordan"
  clientId = "client-provisioning-paid-demo"
  business = "Provisioned Paid Demo"
  nextStatus = "active"
  paymentStatus = "paid"
  source = "nexprospex"
  billingProvider = "manual-json-file"
  billingSourceOfTruth = "local-manual-provider"
  reason = "approved repeated paid provisioning idempotency check"
  actionId = $paidProvisionIdempotencyProposal.action.id
  approvalId = $paidProvisionIdempotencyProposal.approval.id
} "Repeated paid provisioning approval"

$clientAccessAfterRepeatedPaid = Invoke-Json -Uri "$baseUrl/client-access"
Assert-True (@($clientAccessAfterRepeatedPaid.records | Where-Object { $_.id -eq "client-provisioning-paid-demo" }).Count -eq 1) "Repeated paid provisioning should not duplicate the client access record."

$unpaidProvisionProposal = Invoke-Json `
  -Uri "$baseUrl/client-provisioning/propose" `
  -Method "Post" `
  -Body $unpaidProvisioningBody
Assert-True ($unpaidProvisionProposal.action.type -eq "client.provision") "Unpaid provisioning should create a client.provision action."
Assert-True ($unpaidProvisionProposal.action.accessStatus -eq "revoked") "Unpaid provisioning should request blocked access."
Assert-True ($unpaidProvisionProposal.action.billingProvider -eq "manual-json-file") "Unpaid provisioning action should persist the billing provider."
Assert-True ($unpaidProvisionProposal.action.billingSourceOfTruth -eq "local-manual-provider") "Unpaid provisioning action should persist the billing source of truth."
Assert-AuditContent $unpaidProvisionProposal.auditEvent @{
  eventType = "client.provision.proposed"
  actor = "Jordan"
  clientId = "client-provisioning-unpaid-demo"
  business = "Provisioned Unpaid Demo"
  nextStatus = "revoked"
  paymentStatus = "due"
  source = "nexprospex"
  billingProvider = "manual-json-file"
  billingSourceOfTruth = "local-manual-provider"
  reason = "signed agreement before first payment"
  actionId = $unpaidProvisionProposal.action.id
  approvalId = $unpaidProvisionProposal.approval.id
} "Unpaid provisioning proposal"

$unpaidProvisionDecision = Invoke-Json `
  -Uri "$baseUrl/client-access-approvals/$($unpaidProvisionProposal.approval.id)/decision" `
  -Method "Post" `
  -Body @{
    decision = "approve"
    decidedBy = "Jordan"
    reason = "approved blocked provisioning until payment clears"
  }
Assert-True ($unpaidProvisionDecision.action.status -eq "executed") "Approved unpaid provisioning should execute."
Assert-True ($unpaidProvisionDecision.record.paymentStatus -eq "due") "Unpaid provisioning should persist due payment status."
Assert-True ($unpaidProvisionDecision.record.accessStatus -eq "revoked") "Unpaid provisioning should persist blocked access."
Assert-True ($unpaidProvisionDecision.record.connectorCredentials.calendar.credentialRef -eq "local-demo:client-provisioning-unpaid-demo:calendar") "Unpaid provisioning should still create the future calendar credential reference without allowing access."
Assert-AuditContent $unpaidProvisionDecision.auditEvent @{
  eventType = "client.provision.approved"
  actor = "Jordan"
  clientId = "client-provisioning-unpaid-demo"
  business = "Provisioned Unpaid Demo"
  nextStatus = "revoked"
  paymentStatus = "due"
  source = "nexprospex"
  billingProvider = "manual-json-file"
  billingSourceOfTruth = "local-manual-provider"
  reason = "approved blocked provisioning until payment clears"
  actionId = $unpaidProvisionProposal.action.id
  approvalId = $unpaidProvisionProposal.approval.id
} "Unpaid provisioning approval"

Assert-HttpError `
  -StatusCode 403 `
  -Message "Unpaid provisioned workspace should remain blocked until payment." `
  -Call { Invoke-Json -Uri "$baseUrl/client-workspaces/client-provisioning-unpaid-demo" }

$provisioningPangolinPlan = Invoke-Json -Uri "$baseUrl/pangolin/reconcile/dry-run"
$paidProvisionRoutePlan = @($provisioningPangolinPlan.plans | Where-Object { $_.clientId -eq "client-provisioning-paid-demo" })[0]
$unpaidProvisionRoutePlan = @($provisioningPangolinPlan.plans | Where-Object { $_.clientId -eq "client-provisioning-unpaid-demo" })[0]
Assert-True ($paidProvisionRoutePlan.desiredState -eq "enabled") "Paid provisioned client should map to enabled private route."
Assert-True ($paidProvisionRoutePlan.gatewayEnforcement -eq "allow_route") "Paid provisioned route should stay reachable."
Assert-True ($paidProvisionRoutePlan.appEnforcement -eq "full") "Paid provisioned app access should be full."
Assert-True ($unpaidProvisionRoutePlan.desiredState -eq "disabled") "Unpaid provisioned client should map to disabled private route."
Assert-True ($unpaidProvisionRoutePlan.gatewayEnforcement -eq "disable_route") "Unpaid provisioned route should be disabled."
Assert-True ($unpaidProvisionRoutePlan.appEnforcement -eq "blocked") "Unpaid provisioned app access should be blocked."

$workflowAfterProvisioning = Invoke-Json -Uri "$baseUrl/client-access-workflow"
Assert-True (@($workflowAfterProvisioning.actions | Where-Object { $_.type -eq "client.provision" }).Count -ge 2) "Provisioning actions should be present in workflow history."
Assert-True (@($workflowAfterProvisioning.auditEvents | Where-Object { $_.eventType -eq "client.provision.approved" }).Count -ge 2) "Provisioning approvals should be present in audit history."
Assert-WorkflowAuditContent $workflowAfterProvisioning "client.provision.proposed" $paidProvisionProposal.action.id $paidProvisionProposal.approval.id @{
  eventType = "client.provision.proposed"
  actor = "Jordan"
  clientId = "client-provisioning-paid-demo"
  business = "Provisioned Paid Demo"
  nextStatus = "active"
  paymentStatus = "paid"
  source = "nexprospex"
  billingProvider = "manual-json-file"
  billingSourceOfTruth = "local-manual-provider"
  reason = "first payment received from CRM close"
} "Persisted paid provisioning proposal"
Assert-WorkflowAuditContent $workflowAfterProvisioning "client.provision.approved" $paidProvisionProposal.action.id $paidProvisionProposal.approval.id @{
  eventType = "client.provision.approved"
  actor = "Jordan"
  clientId = "client-provisioning-paid-demo"
  business = "Provisioned Paid Demo"
  nextStatus = "active"
  paymentStatus = "paid"
  source = "nexprospex"
  billingProvider = "manual-json-file"
  billingSourceOfTruth = "local-manual-provider"
  reason = "approved paid provisioning workflow"
} "Persisted paid provisioning approval"
Assert-WorkflowAuditContent $workflowAfterProvisioning "client.provision.proposed" $paidProvisionIdempotencyProposal.action.id $paidProvisionIdempotencyProposal.approval.id @{
  eventType = "client.provision.proposed"
  actor = "Jordan"
  clientId = "client-provisioning-paid-demo"
  business = "Provisioned Paid Demo"
  nextStatus = "active"
  paymentStatus = "paid"
  source = "nexprospex"
  billingProvider = "manual-json-file"
  billingSourceOfTruth = "local-manual-provider"
  reason = "first payment received from CRM close"
} "Persisted repeated paid provisioning proposal"
Assert-WorkflowAuditContent $workflowAfterProvisioning "client.provision.approved" $paidProvisionIdempotencyProposal.action.id $paidProvisionIdempotencyProposal.approval.id @{
  eventType = "client.provision.approved"
  actor = "Jordan"
  clientId = "client-provisioning-paid-demo"
  business = "Provisioned Paid Demo"
  nextStatus = "active"
  paymentStatus = "paid"
  source = "nexprospex"
  billingProvider = "manual-json-file"
  billingSourceOfTruth = "local-manual-provider"
  reason = "approved repeated paid provisioning idempotency check"
} "Persisted repeated paid provisioning approval"
Assert-WorkflowAuditContent $workflowAfterProvisioning "client.provision.proposed" $unpaidProvisionProposal.action.id $unpaidProvisionProposal.approval.id @{
  eventType = "client.provision.proposed"
  actor = "Jordan"
  clientId = "client-provisioning-unpaid-demo"
  business = "Provisioned Unpaid Demo"
  nextStatus = "revoked"
  paymentStatus = "due"
  source = "nexprospex"
  billingProvider = "manual-json-file"
  billingSourceOfTruth = "local-manual-provider"
  reason = "signed agreement before first payment"
} "Persisted unpaid provisioning proposal"
Assert-WorkflowAuditContent $workflowAfterProvisioning "client.provision.approved" $unpaidProvisionProposal.action.id $unpaidProvisionProposal.approval.id @{
  eventType = "client.provision.approved"
  actor = "Jordan"
  clientId = "client-provisioning-unpaid-demo"
  business = "Provisioned Unpaid Demo"
  nextStatus = "revoked"
  paymentStatus = "due"
  source = "nexprospex"
  billingProvider = "manual-json-file"
  billingSourceOfTruth = "local-manual-provider"
  reason = "approved blocked provisioning until payment clears"
} "Persisted unpaid provisioning approval"

$allowedModule = Invoke-Json -Uri "$baseUrl/client-workspaces/client-sports-demo/modules/Calendar"
Assert-True ($allowedModule.ok -eq $true) "Enabled module should be accessible."
Assert-True ($allowedModule.module -eq "Calendar") "Enabled module response should identify the module."
Assert-True ($allowedModule.moduleView.moduleKey -eq "Calendar") "Enabled module should return a module handler payload."
Assert-True ($allowedModule.moduleView.title -eq "Calendar") "Calendar handler should identify its title."
Assert-True ($allowedModule.moduleView.mode -eq "full") "Active module handler should run in full mode."
Assert-True ($allowedModule.moduleView.writeAccess -eq $true) "Active module handler should allow write actions."
Assert-True ($allowedModule.moduleView.connector.id -eq "calendar") "Calendar handler should read through the calendar connector boundary."
Assert-True ($allowedModule.moduleView.connector.provider -eq "local-demo-calendar") "Calendar handler should identify the local demo provider."
Assert-True ($allowedModule.moduleView.connector.credentialMode -eq "local_demo") "Calendar handler should not load live credentials in local mode."
Assert-True ($allowedModule.moduleView.connector.credentialSource -eq "workspace_reference") "Calendar handler should resolve a workspace-owned credential reference."
Assert-True ($allowedModule.moduleView.connector.credentialRef -eq "local-demo:client-sports-demo:calendar") "Calendar handler should identify the workspace credential reference."
Assert-True ($allowedModule.moduleView.connector.workspaceId -eq "client-sports-demo") "Calendar handler should bind the credential reference to the workspace."
Assert-True ($allowedModule.moduleView.connector.status -eq "available") "Calendar handler should report the local credential reference as available."
Assert-True ($allowedModule.moduleView.connector.readOnly -eq $true) "Calendar connector should be read-only."
Assert-True ($allowedModule.moduleView.connector.live -eq $false) "Calendar connector should not claim live data."
Assert-True (@($allowedModule.moduleView.primaryActions | Where-Object { $_.id -eq "create-event" -and $_.enabled -eq $true }).Count -eq 1) "Active calendar handler should expose create-event action."
Assert-True (@($allowedModule.moduleView.disabledActions).Count -eq 0) "Active calendar handler should not disable write actions."

Assert-HttpError `
  -StatusCode 403 `
  -Message "Unentitled module should be blocked." `
  -Call { Invoke-Json -Uri "$baseUrl/client-workspaces/client-sports-demo/modules/Reports" }

Assert-HttpError `
  -StatusCode 404 `
  -Message "Direct module mutation endpoint must not exist." `
  -Call {
    Invoke-Json `
      -Uri "$baseUrl/client-access/client-sports-demo/modules/Calendar" `
      -Method "Post" `
      -Body @{ enabled = $false; reason = "direct module bypass attempt" }
  }

$disableModuleProposal = Invoke-Json `
  -Uri "$baseUrl/client-access/client-sports-demo/modules/Calendar/propose" `
  -Method "Post" `
  -Body @{
    enabled = $false
    reason = "module entitlement disable test"
    proposedBy = "Jordan"
  }
Assert-True ($disableModuleProposal.action.type -eq "client.module.set") "Module proposal should create a module action."
Assert-True ($disableModuleProposal.action.status -eq "pending_approval") "Module action should start pending."
Assert-True ($disableModuleProposal.approval.status -eq "pending") "Module approval should start pending."
Assert-AuditContent $disableModuleProposal.auditEvent @{
  eventType = "client.module.proposed"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  moduleKey = "Calendar"
  previousEnabled = $true
  nextEnabled = $false
  reason = "module entitlement disable test"
  actionId = $disableModuleProposal.action.id
  approvalId = $disableModuleProposal.approval.id
} "Module disable proposal"

Assert-HttpError `
  -StatusCode 403 `
  -Message "Client should not approve module entitlement changes." `
  -Call {
    Invoke-Json `
      -Uri "$baseUrl/client-access-approvals/$($disableModuleProposal.approval.id)/decision" `
      -Method "Post" `
      -Headers $sportsClientHeaders `
      -Body @{
        decision = "approve"
        decidedBy = "Client"
        reason = "client attempted approval"
      }
  }

$disableModuleDecision = Invoke-Json `
  -Uri "$baseUrl/client-access-approvals/$($disableModuleProposal.approval.id)/decision" `
  -Method "Post" `
  -Body @{
    decision = "approve"
    decidedBy = "Jordan"
    reason = "approved module entitlement disable test"
  }
Assert-True ($disableModuleDecision.action.status -eq "executed") "Approved module action should execute."
Assert-True ($disableModuleDecision.approval.status -eq "approved") "Module approval should be approved."
Assert-True (($disableModuleDecision.record.modules -notcontains "Calendar")) "Calendar should be removed from module entitlements."
Assert-AuditContent $disableModuleDecision.auditEvent @{
  eventType = "client.module.approved"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  moduleKey = "Calendar"
  previousEnabled = $true
  nextEnabled = $false
  reason = "approved module entitlement disable test"
  actionId = $disableModuleProposal.action.id
  approvalId = $disableModuleProposal.approval.id
} "Module disable approval"

Assert-HttpError `
  -StatusCode 403 `
  -Message "Disabled module should be blocked by request-time guard." `
  -Call { Invoke-Json -Uri "$baseUrl/client-workspaces/client-sports-demo/modules/Calendar" }

$disabledModuleWorkspace = Invoke-Json -Uri "$baseUrl/client-workspaces/client-sports-demo"
Assert-True (($disabledModuleWorkspace.workspace.modules -notcontains "Calendar")) "Disabled module should not appear in workspace modules."

$enableModuleProposal = Invoke-Json `
  -Uri "$baseUrl/client-access/client-sports-demo/modules/Calendar/propose" `
  -Method "Post" `
  -Body @{
    enabled = $true
    reason = "module entitlement restore test"
    proposedBy = "Jordan"
  }
$enableModuleDecision = Invoke-Json `
  -Uri "$baseUrl/client-access-approvals/$($enableModuleProposal.approval.id)/decision" `
  -Method "Post" `
  -Body @{
    decision = "approve"
    decidedBy = "Jordan"
    reason = "approved module entitlement restore test"
  }
Assert-True ($enableModuleDecision.action.status -eq "executed") "Module restore action should execute."
Assert-True (($enableModuleDecision.record.modules -contains "Calendar")) "Calendar should be restored to module entitlements."
Assert-AuditContent $enableModuleProposal.auditEvent @{
  eventType = "client.module.proposed"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  moduleKey = "Calendar"
  previousEnabled = $false
  nextEnabled = $true
  reason = "module entitlement restore test"
  actionId = $enableModuleProposal.action.id
  approvalId = $enableModuleProposal.approval.id
} "Module restore proposal"
Assert-AuditContent $enableModuleDecision.auditEvent @{
  eventType = "client.module.approved"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  moduleKey = "Calendar"
  previousEnabled = $false
  nextEnabled = $true
  reason = "approved module entitlement restore test"
  actionId = $enableModuleProposal.action.id
  approvalId = $enableModuleProposal.approval.id
} "Module restore approval"

$restoredModule = Invoke-Json -Uri "$baseUrl/client-workspaces/client-sports-demo/modules/Calendar"
Assert-True ($restoredModule.ok -eq $true) "Restored module should be accessible again."

$directBypassBlocked = $false
try {
  Invoke-Json `
    -Uri "$baseUrl/client-access/client-sports-demo/status" `
    -Method "Post" `
    -Body @{ accessStatus = "revoked"; reason = "bypass attempt" } | Out-Null
} catch {
  $statusCode = $_.Exception.Response.StatusCode.value__
  $directBypassBlocked = $statusCode -eq 404
}
Assert-True $directBypassBlocked "Direct status mutation endpoint must not exist."

$rejectProposal = Invoke-Json `
  -Uri "$baseUrl/client-access/client-sports-demo/status/propose" `
  -Method "Post" `
  -Body @{
    accessStatus = "revoked"
    reason = "rejection path test"
    proposedBy = "Jordan"
  }
Assert-True ($rejectProposal.action.status -eq "pending_approval") "Rejected test proposal should start pending."
Assert-AuditContent $rejectProposal.auditEvent @{
  eventType = "client.access.proposed"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  previousStatus = "active"
  nextStatus = "revoked"
  reason = "rejection path test"
  actionId = $rejectProposal.action.id
  approvalId = $rejectProposal.approval.id
} "Rejected access proposal"

$rejectDecision = Invoke-Json `
  -Uri "$baseUrl/client-access-approvals/$($rejectProposal.approval.id)/decision" `
  -Method "Post" `
  -Body @{
    decision = "reject"
    decidedBy = "Jordan"
    reason = "keep client active for test"
  }
Assert-True ($rejectDecision.approval.status -eq "rejected") "Rejected approval should be marked rejected."
Assert-True ($rejectDecision.record.accessStatus -eq "active") "Rejected revocation must not change client access."
Assert-AuditContent $rejectDecision.auditEvent @{
  eventType = "client.access.rejected"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  previousStatus = "active"
  nextStatus = "revoked"
  reason = "keep client active for test"
  actionId = $rejectProposal.action.id
  approvalId = $rejectProposal.approval.id
} "Rejected access decision"

$revokeProposal = Invoke-Json `
  -Uri "$baseUrl/client-access/client-sports-demo/status/propose" `
  -Method "Post" `
  -Body @{
    accessStatus = "revoked"
    reason = "non-payment workflow test"
    proposedBy = "Jordan"
  }
Assert-True ($revokeProposal.action.status -eq "pending_approval") "Revocation should start pending."
Assert-True ($revokeProposal.approval.status -eq "pending") "Revocation approval should start pending."
Assert-AuditContent $revokeProposal.auditEvent @{
  eventType = "client.access.proposed"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  previousStatus = "active"
  nextStatus = "revoked"
  reason = "non-payment workflow test"
  actionId = $revokeProposal.action.id
  approvalId = $revokeProposal.approval.id
} "Revocation proposal"

$revokeDecision = Invoke-Json `
  -Uri "$baseUrl/client-access-approvals/$($revokeProposal.approval.id)/decision" `
  -Method "Post" `
  -Body @{
    decision = "approve"
    decidedBy = "Jordan"
    reason = "approved non-payment workflow test"
  }
Assert-True ($revokeDecision.action.status -eq "executed") "Approved revocation action should execute."
Assert-True ($revokeDecision.approval.status -eq "approved") "Revocation approval should be approved."
Assert-True ($revokeDecision.record.accessStatus -eq "revoked") "Client should be revoked after approval."
Assert-True ($revokeDecision.decision.allowed -eq $false) "Revoked client decision should block access."
Assert-AuditContent $revokeDecision.auditEvent @{
  eventType = "client.access.approved"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  previousStatus = "active"
  nextStatus = "revoked"
  reason = "approved non-payment workflow test"
  actionId = $revokeProposal.action.id
  approvalId = $revokeProposal.approval.id
} "Revocation approval"

Assert-HttpError `
  -StatusCode 403 `
  -Message "Revoked workspace should be blocked." `
  -Call { Invoke-Json -Uri "$baseUrl/client-workspaces/client-sports-demo" }

$workflowAfterRevoke = Invoke-Json -Uri "$baseUrl/client-access-workflow"
Assert-True ($workflowAfterRevoke.auditEvents.Count -ge 4) "Workflow should contain audit events."
Assert-True ($workflowAfterRevoke.auditEvents[0].eventType -eq "client.access.approved") "Latest audit should record approved access change."
Assert-WorkflowAuditContent $workflowAfterRevoke "client.module.proposed" $disableModuleProposal.action.id $disableModuleProposal.approval.id @{
  eventType = "client.module.proposed"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  moduleKey = "Calendar"
  previousEnabled = $true
  nextEnabled = $false
  reason = "module entitlement disable test"
} "Persisted module disable proposal"
Assert-WorkflowAuditContent $workflowAfterRevoke "client.module.approved" $disableModuleProposal.action.id $disableModuleProposal.approval.id @{
  eventType = "client.module.approved"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  moduleKey = "Calendar"
  previousEnabled = $true
  nextEnabled = $false
  reason = "approved module entitlement disable test"
} "Persisted module disable approval"
Assert-WorkflowAuditContent $workflowAfterRevoke "client.module.proposed" $enableModuleProposal.action.id $enableModuleProposal.approval.id @{
  eventType = "client.module.proposed"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  moduleKey = "Calendar"
  previousEnabled = $false
  nextEnabled = $true
  reason = "module entitlement restore test"
} "Persisted module restore proposal"
Assert-WorkflowAuditContent $workflowAfterRevoke "client.module.approved" $enableModuleProposal.action.id $enableModuleProposal.approval.id @{
  eventType = "client.module.approved"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  moduleKey = "Calendar"
  previousEnabled = $false
  nextEnabled = $true
  reason = "approved module entitlement restore test"
} "Persisted module restore approval"
Assert-WorkflowAuditContent $workflowAfterRevoke "client.access.proposed" $rejectProposal.action.id $rejectProposal.approval.id @{
  eventType = "client.access.proposed"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  previousStatus = "active"
  nextStatus = "revoked"
  reason = "rejection path test"
} "Persisted rejected access proposal"
Assert-WorkflowAuditContent $workflowAfterRevoke "client.access.rejected" $rejectProposal.action.id $rejectProposal.approval.id @{
  eventType = "client.access.rejected"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  previousStatus = "active"
  nextStatus = "revoked"
  reason = "keep client active for test"
} "Persisted rejected access decision"
Assert-WorkflowAuditContent $workflowAfterRevoke "client.access.proposed" $revokeProposal.action.id $revokeProposal.approval.id @{
  eventType = "client.access.proposed"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  previousStatus = "active"
  nextStatus = "revoked"
  reason = "non-payment workflow test"
} "Persisted revocation proposal"
Assert-WorkflowAuditContent $workflowAfterRevoke "client.access.approved" $revokeProposal.action.id $revokeProposal.approval.id @{
  eventType = "client.access.approved"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  previousStatus = "active"
  nextStatus = "revoked"
  reason = "approved non-payment workflow test"
} "Persisted revocation approval"
Assert-True ($workflowAfterRevoke.repository.driver -eq $expectedRepositoryDriver) "Access repository should report expected driver."
Assert-True ($workflowAfterRevoke.repository.migrationTarget -eq "prisma-postgres") "Access repository should advertise Prisma/Postgres migration target."
Assert-True ($workflowAfterRevoke.repository.prismaWriteMode -eq $expectedPrismaWriteMode) "Access repository should report expected Prisma write mode."
Assert-True ($workflowAfterRevoke.repository.prismaStartupTimeoutMs -gt 0) "Access repository should report a Prisma startup timeout."
if ($expectedRepositoryDriver -eq "json-file") {
  Assert-True ($workflowAfterRevoke.repository.failClosedOnPrismaError -eq $false) "JSON repository should not claim Prisma fail-closed mode."
  Assert-True ($workflowAfterRevoke.repository.repositoryModeReason -ne "DATABASE_URL configured") "JSON repository should not report configured Prisma mode."
  Assert-True (Test-Path -LiteralPath $workflowAfterRevoke.storage.accessRecordsPath) "Access records storage file should exist."
  Assert-True (Test-Path -LiteralPath $workflowAfterRevoke.storage.accessWorkflowPath) "Access workflow storage file should exist."
}
if ($expectedRepositoryDriver -eq "prisma-postgres") {
  Assert-True ($workflowAfterRevoke.repository.failClosedOnPrismaError -eq $true) "Prisma repository should report fail-closed mode."
  Assert-True ($workflowAfterRevoke.repository.repositoryModeReason -eq "DATABASE_URL configured") "Prisma repository should report DATABASE_URL configured mode."
}

$restoreProposal = Invoke-Json `
  -Uri "$baseUrl/client-access/client-sports-demo/status/propose" `
  -Method "Post" `
  -Body @{
    accessStatus = "active"
    reason = "restore after workflow test"
    proposedBy = "Jordan"
  }
$restoreDecision = Invoke-Json `
  -Uri "$baseUrl/client-access-approvals/$($restoreProposal.approval.id)/decision" `
  -Method "Post" `
  -Body @{
    decision = "approve"
    decidedBy = "Jordan"
    reason = "restore after workflow test"
  }
Assert-True ($restoreDecision.action.status -eq "executed") "Restore action should execute."
Assert-True ($restoreDecision.record.accessStatus -eq "active") "Client should be active after restore."
Assert-True ($restoreDecision.decision.allowed -eq $true) "Restored client decision should allow access."
Assert-AuditContent $restoreProposal.auditEvent @{
  eventType = "client.access.proposed"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  previousStatus = "revoked"
  nextStatus = "active"
  reason = "restore after workflow test"
  actionId = $restoreProposal.action.id
  approvalId = $restoreProposal.approval.id
} "Restore proposal"
Assert-AuditContent $restoreDecision.auditEvent @{
  eventType = "client.access.approved"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  previousStatus = "revoked"
  nextStatus = "active"
  reason = "restore after workflow test"
  actionId = $restoreProposal.action.id
  approvalId = $restoreProposal.approval.id
} "Restore approval"

$pastDueProposal = Invoke-Json `
  -Uri "$baseUrl/client-access/client-sports-demo/status/propose" `
  -Method "Post" `
  -Body @{
    accessStatus = "past_due"
    reason = "past-due guard test"
    proposedBy = "Jordan"
  }
$pastDueDecision = Invoke-Json `
  -Uri "$baseUrl/client-access-approvals/$($pastDueProposal.approval.id)/decision" `
  -Method "Post" `
  -Body @{
    decision = "approve"
    decidedBy = "Jordan"
    reason = "past-due guard test"
  }
Assert-True ($pastDueDecision.record.accessStatus -eq "past_due") "Client should become past_due."
Assert-AuditContent $pastDueProposal.auditEvent @{
  eventType = "client.access.proposed"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  previousStatus = "active"
  nextStatus = "past_due"
  reason = "past-due guard test"
  actionId = $pastDueProposal.action.id
  approvalId = $pastDueProposal.approval.id
} "Past-due proposal"
Assert-AuditContent $pastDueDecision.auditEvent @{
  eventType = "client.access.approved"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  previousStatus = "active"
  nextStatus = "past_due"
  reason = "past-due guard test"
  actionId = $pastDueProposal.action.id
  approvalId = $pastDueProposal.approval.id
} "Past-due approval"

$pastDueWorkspace = Invoke-Json -Uri "$baseUrl/client-workspaces/client-sports-demo"
Assert-True ($pastDueWorkspace.workspace.mode -eq "read_only") "Past-due workspace should be read-only."
Assert-True ($pastDueWorkspace.decision.allowed -eq $true) "Past-due workspace should remain visible."

$pastDueCalendar = Invoke-Json -Uri "$baseUrl/client-workspaces/client-sports-demo/modules/Calendar"
Assert-True ($pastDueCalendar.moduleView.mode -eq "read_only") "Past-due module handler should run in read-only mode."
Assert-True ($pastDueCalendar.moduleView.writeAccess -eq $false) "Past-due module handler should disable write access."
Assert-True ($pastDueCalendar.moduleView.connector.id -eq "calendar") "Past-due calendar handler should still read through the connector boundary."
Assert-True ($pastDueCalendar.moduleView.connector.readOnly -eq $true) "Past-due calendar connector should remain read-only."
Assert-True ($pastDueCalendar.moduleView.connector.credentialRef -eq "local-demo:client-sports-demo:calendar") "Past-due calendar handler should keep the same workspace credential reference."
Assert-True ($pastDueCalendar.moduleView.connector.status -eq "available") "Past-due calendar handler should keep the credential reference available for reads."
Assert-True (@($pastDueCalendar.moduleView.primaryActions | Where-Object { $_.id -eq "view-calendar" -and $_.enabled -eq $true }).Count -eq 1) "Past-due calendar handler should still allow read actions."
Assert-True (@($pastDueCalendar.moduleView.disabledActions | Where-Object { $_.id -eq "create-event" -and $_.enabled -eq $false }).Count -eq 1) "Past-due calendar handler should disable create-event action."

$pastDuePangolinPlan = Invoke-Json -Uri "$baseUrl/pangolin/reconcile/dry-run"
$pastDueRoutePlan = @($pastDuePangolinPlan.plans | Where-Object { $_.clientId -eq "client-sports-demo" })[0]
Assert-True ($pastDueRoutePlan.desiredState -eq "read_only") "Past-due client should map to read-only Pangolin route."
Assert-True ($pastDueRoutePlan.gatewayEnforcement -eq "allow_route") "Past-due client should keep the Pangolin route reachable."
Assert-True ($pastDueRoutePlan.appEnforcement -eq "read_only") "Past-due client should be read-only in PhantomForce handlers."
Assert-True ($pastDueRoutePlan.enforcementNote -like "*module handlers enforce read-only*") "Past-due note should identify app-layer read-only enforcement."

$finalRestoreProposal = Invoke-Json `
  -Uri "$baseUrl/client-access/client-sports-demo/status/propose" `
  -Method "Post" `
  -Body @{
    accessStatus = "active"
    reason = "final restore after guard test"
    proposedBy = "Jordan"
  }
$finalRestoreDecision = Invoke-Json `
  -Uri "$baseUrl/client-access-approvals/$($finalRestoreProposal.approval.id)/decision" `
  -Method "Post" `
  -Body @{
    decision = "approve"
    decidedBy = "Jordan"
    reason = "final restore after guard test"
  }
Assert-True ($finalRestoreDecision.record.accessStatus -eq "active") "Client should be restored after guard test."
Assert-AuditContent $finalRestoreProposal.auditEvent @{
  eventType = "client.access.proposed"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  previousStatus = "past_due"
  nextStatus = "active"
  reason = "final restore after guard test"
  actionId = $finalRestoreProposal.action.id
  approvalId = $finalRestoreProposal.approval.id
} "Final restore proposal"
Assert-AuditContent $finalRestoreDecision.auditEvent @{
  eventType = "client.access.approved"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  previousStatus = "past_due"
  nextStatus = "active"
  reason = "final restore after guard test"
  actionId = $finalRestoreProposal.action.id
  approvalId = $finalRestoreProposal.approval.id
} "Final restore approval"

$finalWorkflow = Invoke-Json -Uri "$baseUrl/client-access-workflow"
Assert-WorkflowAuditContent $finalWorkflow "client.access.proposed" $restoreProposal.action.id $restoreProposal.approval.id @{
  eventType = "client.access.proposed"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  previousStatus = "revoked"
  nextStatus = "active"
  reason = "restore after workflow test"
} "Persisted restore proposal"
Assert-WorkflowAuditContent $finalWorkflow "client.access.approved" $restoreProposal.action.id $restoreProposal.approval.id @{
  eventType = "client.access.approved"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  previousStatus = "revoked"
  nextStatus = "active"
  reason = "restore after workflow test"
} "Persisted restore approval"
Assert-WorkflowAuditContent $finalWorkflow "client.access.proposed" $pastDueProposal.action.id $pastDueProposal.approval.id @{
  eventType = "client.access.proposed"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  previousStatus = "active"
  nextStatus = "past_due"
  reason = "past-due guard test"
} "Persisted past-due proposal"
Assert-WorkflowAuditContent $finalWorkflow "client.access.approved" $pastDueProposal.action.id $pastDueProposal.approval.id @{
  eventType = "client.access.approved"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  previousStatus = "active"
  nextStatus = "past_due"
  reason = "past-due guard test"
} "Persisted past-due approval"
Assert-WorkflowAuditContent $finalWorkflow "client.access.proposed" $finalRestoreProposal.action.id $finalRestoreProposal.approval.id @{
  eventType = "client.access.proposed"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  previousStatus = "past_due"
  nextStatus = "active"
  reason = "final restore after guard test"
} "Persisted final restore proposal"
Assert-WorkflowAuditContent $finalWorkflow "client.access.approved" $finalRestoreProposal.action.id $finalRestoreProposal.approval.id @{
  eventType = "client.access.approved"
  actor = "Jordan"
  clientId = "client-sports-demo"
  business = "Sports Ops Demo"
  previousStatus = "past_due"
  nextStatus = "active"
  reason = "final restore after guard test"
} "Persisted final restore approval"

$snapshotResponse = Invoke-Json `
  -Uri "$baseUrl/client-access-workflow/snapshot" `
  -Method "Post" `
  -Body @{ label = "access-workflow-test" }
Assert-True ($snapshotResponse.ok -eq $true) "Admin should create a local workflow recovery snapshot."
Assert-True (Test-Path -LiteralPath $snapshotResponse.snapshot.snapshotPath) "Snapshot directory should exist."
Assert-True ($snapshotResponse.storage.snapshotsDir.Length -gt 0) "Storage metadata should expose the snapshot directory."
Assert-True ($snapshotResponse.storage.accessRecordsBackupPath.Length -gt 0) "Storage metadata should expose the records backup path."
Assert-True ($snapshotResponse.storage.accessWorkflowBackupPath.Length -gt 0) "Storage metadata should expose the workflow backup path."
if ($expectedRepositoryDriver -eq "json-file") {
  Assert-True (Test-Path -LiteralPath $snapshotResponse.snapshot.accessRecordsSnapshotPath) "JSON snapshot should include access records."
  Assert-True (Test-Path -LiteralPath $snapshotResponse.snapshot.accessWorkflowSnapshotPath) "JSON snapshot should include workflow history."
  Assert-True (Test-Path -LiteralPath $snapshotResponse.storage.accessRecordsBackupPath) "JSON writes should keep an access records backup file."
  Assert-True (Test-Path -LiteralPath $snapshotResponse.storage.accessWorkflowBackupPath) "JSON writes should keep an access workflow backup file."
}

$summary = [pscustomobject]@{
  ok = $true
  server = $baseUrl
  directBypassBlocked = $directBypassBlocked
  sessionBoundary = $true
  signedSessionAuth = $true
  moduleEntitlementGuard = $true
  auditContentAssertions = $script:auditContentAssertions
  driverParitySuite = $true
  malformedProvisioningFailClosed = $true
  storageSnapshotCreated = $true
  billingSourceBoundary = $true
  readinessLocalDemoReady = $readiness.report.localDemoReady
  readinessProductionReady = $readiness.report.productionReady
  pangolinDryRun = $true
  pangolinReadOnlyStatus = $true
  repositoryDriver = $workflowAfterRevoke.repository.driver
  prismaWriteMode = $workflowAfterRevoke.repository.prismaWriteMode
  repositoryModeReason = $workflowAfterRevoke.repository.repositoryModeReason
  failClosedOnPrismaError = $workflowAfterRevoke.repository.failClosedOnPrismaError
  prismaStartupTimeoutMs = $workflowAfterRevoke.repository.prismaStartupTimeoutMs
  finalClientStatus = $finalRestoreDecision.record.accessStatus
  finalAllowed = $finalRestoreDecision.decision.allowed
  auditEvents = $finalWorkflow.auditEvents.Count
  accessRecordsPath = $workflowAfterRevoke.storage.accessRecordsPath
  accessWorkflowPath = $workflowAfterRevoke.storage.accessWorkflowPath
}

$summary | ConvertTo-Json -Compress
