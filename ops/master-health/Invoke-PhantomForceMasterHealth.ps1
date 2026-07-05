param(
  [ValidateSet("heartbeat", "daily")]
  [string]$Mode = "daily",
  [string]$RepoRoot = "",
  [string]$VaultRoot = "C:\Users\jorda\Documents\Obsidian\PhantomForce-Command-Center",
  [switch]$SkipDefenderScan
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$ReportDir = Join-Path $VaultRoot "System Health"
$RuntimeDir = Join-Path $env:LOCALAPPDATA "PhantomForce\MasterHealth"
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

$StartedAt = Get-Date
$Stamp = $StartedAt.ToString("yyyy-MM-dd_HHmmss")
$Today = $StartedAt.ToString("yyyy-MM-dd")
$Issues = New-Object System.Collections.Generic.List[object]

function Add-Issue {
  param(
    [ValidateSet("info", "warn", "error")]
    [string]$Level,
    [string]$Area,
    [string]$Message
  )
  $script:Issues.Add([pscustomobject]@{
    level = $Level
    area = $Area
    message = $Message
  }) | Out-Null
}

function Format-Bytes {
  param([double]$Bytes)
  if ($Bytes -ge 1TB) { return ("{0:n1} TB" -f ($Bytes / 1TB)) }
  if ($Bytes -ge 1GB) { return ("{0:n1} GB" -f ($Bytes / 1GB)) }
  if ($Bytes -ge 1MB) { return ("{0:n1} MB" -f ($Bytes / 1MB)) }
  if ($Bytes -ge 1KB) { return ("{0:n1} KB" -f ($Bytes / 1KB)) }
  return ("{0:n0} B" -f $Bytes)
}

function Test-HttpEndpoint {
  param(
    [string]$Name,
    [string]$Url,
    [int]$TimeoutSec = 12
  )
  $started = Get-Date
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec $TimeoutSec -Headers @{ "Cache-Control" = "no-cache" }
    return [pscustomobject]@{
      name = $Name
      url = $Url
      ok = ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400)
      status = [int]$response.StatusCode
      ms = [int]((Get-Date) - $started).TotalMilliseconds
      detail = ""
    }
  } catch {
    $status = $null
    try { $status = [int]$_.Exception.Response.StatusCode.value__ } catch {}
    return [pscustomobject]@{
      name = $Name
      url = $Url
      ok = $false
      status = $status
      ms = [int]((Get-Date) - $started).TotalMilliseconds
      detail = $_.Exception.Message
    }
  }
}

function Get-SystemSnapshot {
  $os = Get-CimInstance Win32_OperatingSystem
  $uptime = (Get-Date) - $os.LastBootUpTime
  $totalMem = [double]$os.TotalVisibleMemorySize * 1KB
  $freeMem = [double]$os.FreePhysicalMemory * 1KB
  $usedMem = $totalMem - $freeMem
  $usedPct = if ($totalMem -gt 0) { [math]::Round(($usedMem / $totalMem) * 100, 1) } else { 0 }

  if ($usedPct -ge 90) {
    Add-Issue warn "memory" "Memory pressure is high at $usedPct%."
  }

  [pscustomobject]@{
    computer = $env:COMPUTERNAME
    user = $env:USERNAME
    mode = $Mode
    is_admin_shell = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    uptime_hours = [math]::Round($uptime.TotalHours, 1)
    memory_total = Format-Bytes $totalMem
    memory_free = Format-Bytes $freeMem
    memory_used_pct = $usedPct
    windows = $os.Caption
    build = $os.BuildNumber
  }
}

function Get-DiskSnapshot {
  $disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
    $freePct = if ($_.Size -gt 0) { [math]::Round(($_.FreeSpace / $_.Size) * 100, 1) } else { 0 }
    if ($_.DeviceID -eq "C:" -and ($_.FreeSpace -lt 25GB -or $freePct -lt 10)) {
      Add-Issue warn "disk" "C: free space is low: $(Format-Bytes $_.FreeSpace) ($freePct%)."
    }
    [pscustomobject]@{
      drive = $_.DeviceID
      label = $_.VolumeName
      size = Format-Bytes $_.Size
      free = Format-Bytes $_.FreeSpace
      free_pct = $freePct
    }
  }

  $physical = @()
  try {
    $physical = Get-PhysicalDisk -ErrorAction Stop | Select-Object FriendlyName, MediaType, HealthStatus, OperationalStatus, Size
  } catch {
    Add-Issue info "disk" "Physical disk health counters were not available in this shell."
  }

  [pscustomobject]@{
    logical = @($disks)
    physical = @($physical)
  }
}

function Get-ProcessSnapshot {
  $topMemory = Get-Process |
    Sort-Object WorkingSet64 -Descending |
    Select-Object -First 15 ProcessName, Id, @{Name = "memory"; Expression = { Format-Bytes $_.WorkingSet64 } }, @{Name = "memory_bytes"; Expression = { $_.WorkingSet64 } }

  $headlessChrome = Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "--headless|remote-debugging-port|pf-cdp|phantom-deck|codex" } |
    Select-Object ProcessId, ParentProcessId, CommandLine

  if (@($headlessChrome).Count -gt 0) {
    Add-Issue warn "process" "$(@($headlessChrome).Count) headless/debug Chrome process(es) are still running."
  }

  [pscustomobject]@{
    top_memory = @($topMemory)
    headless_chrome = @($headlessChrome)
  }
}

function Get-ShortcutTarget {
  param([string]$Path)
  try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    return [pscustomobject]@{
      target = $shortcut.TargetPath
      arguments = $shortcut.Arguments
      working_directory = $shortcut.WorkingDirectory
      window_style = $shortcut.WindowStyle
    }
  } catch {
    return [pscustomobject]@{
      target = ""
      arguments = ""
      working_directory = ""
      window_style = $null
    }
  }
}

function Get-ConsoleStartupAudit {
  $now = Get-Date
  $shellProcesses = @()
  try {
    $processWindowTitles = @{}
    Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
      $processWindowTitles[[int]$_.Id] = $_.MainWindowTitle
    }

    $parentNames = @{}
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
      $parentNames[[int]$_.ProcessId] = $_.Name
    }

    $shellProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match "^(cmd|powershell|pwsh|WindowsTerminal|OpenConsole)\.exe$" } |
      ForEach-Object {
        $created = $null
        try { $created = [Management.ManagementDateTimeConverter]::ToDateTime($_.CreationDate) } catch {}
        $ageHours = if ($created) { [math]::Round(($now - $created).TotalHours, 2) } else { $null }
        $command = [string]$_.CommandLine
        [pscustomobject]@{
          name = $_.Name
          pid = [int]$_.ProcessId
          parent_pid = [int]$_.ParentProcessId
          parent = $parentNames[[int]$_.ParentProcessId]
          age_hours = $ageHours
          window_title = $processWindowTitles[[int]$_.ProcessId]
          command = if ($command.Length -gt 260) { $command.Substring(0, 260) + "..." } else { $command }
        }
      }
  } catch {
    Add-Issue info "console audit" "Could not read console process details: $($_.Exception.Message)"
  }

  $thisScriptPath = if ($PSCommandPath) { $PSCommandPath } else { "" }
  $thisScriptPattern = if ($thisScriptPath) { [regex]::Escape($thisScriptPath) } else { "Invoke-PhantomForceMasterHealth" }
  $longRunningDevShells = @($shellProcesses | Where-Object {
    $_.age_hours -ge 2 -and
    $_.command -match "npm run dev|tsx watch|run dev:server|vite preview|node dist/index\.js|npm run start" -and
    $_.command -notmatch "Invoke-PhantomForceMasterHealth|Invoke-PhantomForceExternalSurfaceScan|$thisScriptPattern"
  })
  if ($longRunningDevShells.Count -ge 6) {
    Add-Issue warn "console audit" "$($longRunningDevShells.Count) long-running dev/server shell processes are active. This can cause CMD/conhost clutter and popups."
  } elseif ($longRunningDevShells.Count -gt 0) {
    Add-Issue info "console audit" "$($longRunningDevShells.Count) long-running dev/server shell process(es) are active."
  }
  if (@($shellProcesses).Count -ge 40) {
    Add-Issue warn "console audit" "$(@($shellProcesses).Count) shell/conhost-related processes are active. Review for stale dev workers or popup sources."
  }

  $startupEntries = @()
  $startupFolders = @(
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"),
    (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\Startup")
  )
  foreach ($folder in $startupFolders) {
    if (-not (Test-Path $folder)) { continue }
    foreach ($file in Get-ChildItem -LiteralPath $folder -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne "desktop.ini" }) {
      $shortcut = if ($file.Extension -ieq ".lnk") { Get-ShortcutTarget -Path $file.FullName } else { $null }
      $target = if ($shortcut) { $shortcut.target } else { $file.FullName }
      $arguments = if ($shortcut) { $shortcut.arguments } else { "" }
      $hiddenArgs = $arguments -match "WindowStyle\s+Hidden|//B|/min\b"
      $minimizedShortcut = $shortcut -and $shortcut.window_style -eq 7
      $directScript = $file.Extension -match "\.(cmd|bat|ps1)$" -or $target -match "\.(cmd|bat|ps1)$"
      $shellLauncher = $target -match "\\(cmd|powershell|pwsh)\.exe$"
      $canFlash = $directScript -or ($shellLauncher -and -not $hiddenArgs -and -not $minimizedShortcut)
      $startupEntries += [pscustomobject]@{
        name = $file.Name
        folder = $folder
        path = $file.FullName
        extension = $file.Extension
        target = $target
        arguments = $arguments
        window_style = if ($shortcut) { $shortcut.window_style } else { $null }
        hidden_args = [bool]$hiddenArgs
        minimized_shortcut = [bool]$minimizedShortcut
        direct_script = [bool]$directScript
        shell_launcher = [bool]$shellLauncher
        can_flash_console = [bool]$canFlash
      }
    }
  }
  $flashStartup = @($startupEntries | Where-Object { $_.can_flash_console })
  if ($flashStartup.Count -gt 0) {
    Add-Issue warn "startup" "$($flashStartup.Count) startup item(s) can open a console window: $((@($flashStartup | Select-Object -First 3 -ExpandProperty name)) -join ', ')."
  }

  $runEntries = @()
  foreach ($runPath in "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run", "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run") {
    try {
      $props = Get-ItemProperty -Path $runPath -ErrorAction Stop
      foreach ($prop in $props.PSObject.Properties | Where-Object { $_.Name -notmatch "^PS" }) {
        $value = [string]$prop.Value
        $runEntries += [pscustomobject]@{
          hive = $runPath
          name = $prop.Name
          command = if ($value.Length -gt 260) { $value.Substring(0, 260) + "..." } else { $value }
          shell_launcher = [bool]($value -match "cmd\.exe|powershell\.exe|pwsh\.exe")
        }
      }
    } catch {}
  }
  $shellRunEntries = @($runEntries | Where-Object { $_.shell_launcher })
  if ($shellRunEntries.Count -gt 0) {
    Add-Issue warn "startup" "$($shellRunEntries.Count) Run-registry startup item(s) launch through a shell."
  }

  $taskShellLaunchers = @()
  try {
    $tasks = schtasks.exe /Query /FO CSV /V 2>$null | ConvertFrom-Csv
    $taskShellLaunchers = @($tasks | Where-Object {
      $_.TaskName -notmatch "^\\Microsoft\\" -and
      $_.Status -ne "Disabled" -and
      $_.'Task To Run' -match "cmd\.exe|powershell\.exe|pwsh\.exe|npm|node" -and
      $_.'Task To Run' -notmatch "WindowStyle Hidden|wscript\.exe //B|//B //Nologo"
    } | Select-Object TaskName, Status, 'Next Run Time', 'Task To Run')
  } catch {
    Add-Issue info "task audit" "Could not query scheduled task launch commands: $($_.Exception.Message)"
  }
  if ($taskShellLaunchers.Count -gt 0) {
    Add-Issue warn "task audit" "$($taskShellLaunchers.Count) non-Microsoft scheduled task(s) may show a shell window."
  }

  [pscustomobject]@{
    shell_process_count = @($shellProcesses).Count
    long_running_dev_shell_count = $longRunningDevShells.Count
    long_running_dev_shells = @($longRunningDevShells | Select-Object -First 25)
    startup_entries = @($startupEntries)
    console_startup_entries = @($flashStartup)
    run_entries = @($runEntries)
    shell_run_entries = @($shellRunEntries)
    visible_shell_scheduled_tasks = @($taskShellLaunchers | Select-Object -First 25)
  }
}

function Get-PortSnapshot {
  $ports = 5177, 5190, 8787, 11434, 5678, 3000, 5188
  $listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in $ports } |
    ForEach-Object {
      $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
      [pscustomobject]@{
        local_address = $_.LocalAddress
        port = $_.LocalPort
        pid = $_.OwningProcess
        process = $proc.ProcessName
      }
    } |
    Sort-Object port

  foreach ($required in 5177, 5190) {
    if (-not (@($listeners) | Where-Object { $_.port -eq $required })) {
      Add-Issue warn "phantomforce" "Expected local PhantomForce port $required is not listening."
    }
  }

  [pscustomobject]@{
    listeners = @($listeners)
  }
}

function Get-EndpointSnapshot {
  $checks = @(
    @{ name = "Local admin frontend"; url = "http://127.0.0.1:5177/" },
    @{ name = "Local admin app"; url = "http://127.0.0.1:5177/app/index.html" },
    @{ name = "Local backend health"; url = "http://127.0.0.1:5190/health" },
    @{ name = "Ollama tags"; url = "http://127.0.0.1:11434/api/tags" },
    @{ name = "Public admin"; url = "https://admin.phantomforce.online/" },
    @{ name = "Public landing"; url = "https://phantomforce.online/" }
  )

  $results = foreach ($check in $checks) {
    Test-HttpEndpoint -Name $check.name -Url $check.url
  }

  foreach ($result in $results) {
    if (-not $result.ok) {
      Add-Issue warn "endpoint" "$($result.name) failed: $($result.status) $($result.detail)"
    }
  }

  [pscustomobject]@{
    checks = @($results)
  }
}

function Get-DefenderSnapshot {
  $status = $null
  $scan = [pscustomobject]@{
    attempted = $false
    ok = $null
    detail = "Skipped."
  }

  if (Get-Command Get-MpComputerStatus -ErrorAction SilentlyContinue) {
    try {
      $raw = Get-MpComputerStatus
      $status = [pscustomobject]@{
        antivirus_enabled = $raw.AntivirusEnabled
        antispyware_enabled = $raw.AntispywareEnabled
        real_time_protection_enabled = $raw.RealTimeProtectionEnabled
        quick_scan_age = $raw.QuickScanAge
        full_scan_age = $raw.FullScanAge
        signature_last_updated = $raw.AntivirusSignatureLastUpdated
      }
      if ($raw.RealTimeProtectionEnabled -ne $true) {
        Add-Issue error "defender" "Windows Defender real-time protection is not enabled."
      }
      if (($Mode -ne "daily" -or $SkipDefenderScan) -and $null -ne $raw.QuickScanAge -and $raw.QuickScanAge -gt 2) {
        Add-Issue warn "defender" "Defender quick scan age is $($raw.QuickScanAge) days."
      }
    } catch {
      Add-Issue warn "defender" "Could not read Defender status: $($_.Exception.Message)"
    }
  } else {
    Add-Issue warn "defender" "Get-MpComputerStatus is not available."
  }

  if ($Mode -eq "daily" -and -not $SkipDefenderScan) {
    if (Get-Command Start-MpScan -ErrorAction SilentlyContinue) {
      $scan = [pscustomobject]@{
        attempted = $true
        ok = $false
        detail = ""
      }
      try {
        Start-MpScan -ScanType QuickScan
        $scan.ok = $true
        $scan.detail = "Quick scan completed."
      } catch {
        $scan.detail = $_.Exception.Message
        Add-Issue warn "defender" "Defender quick scan could not complete: $($scan.detail)"
      }
    } else {
      Add-Issue warn "defender" "Start-MpScan is not available."
    }
  }

  [pscustomobject]@{
    status = $status
    quick_scan = $scan
  }
}

function Get-ClamAvSnapshot {
  $clamscan = Get-Command clamscan -ErrorAction SilentlyContinue
  $freshclam = Get-Command freshclam -ErrorAction SilentlyContinue
  if (-not $clamscan) {
    return [pscustomobject]@{
      installed = $false
      clamscan = $null
      freshclam = $null
      note = "ClamAV is not installed or not on PATH."
    }
  }

  $version = ""
  try { $version = (& $clamscan.Source --version 2>$null) -join "`n" } catch {}
  [pscustomobject]@{
    installed = $true
    clamscan = $clamscan.Source
    freshclam = $freshclam.Source
    version = $version
    note = "Installed. The master health loop records availability; Defender remains the default daily scan."
  }
}

function Get-GitSnapshot {
  if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
    return [pscustomobject]@{ repo = $RepoRoot; ok = $false; detail = "Not a git repo." }
  }

  try {
    $branch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null) -join ""
    $head = (& git -C $RepoRoot rev-parse --short HEAD 2>$null) -join ""
    $dirty = @(& git -C $RepoRoot status --porcelain 2>$null)
    [pscustomobject]@{
      repo = $RepoRoot
      ok = $true
      branch = $branch
      head = $head
      dirty_count = @($dirty).Count
    }
  } catch {
    Add-Issue info "git" "Could not read git status: $($_.Exception.Message)"
    [pscustomobject]@{ repo = $RepoRoot; ok = $false; detail = $_.Exception.Message }
  }
}

function Get-ExternalSurfaceSnapshot {
  if ($Mode -ne "daily") {
    return [pscustomobject]@{
      attempted = $false
      overall = "not_run"
      warnings = 0
      errors = 0
      report = ""
      detail = "External surface scan runs in daily mode."
    }
  }

  $scanScript = Join-Path $PSScriptRoot "Invoke-PhantomForceExternalSurfaceScan.ps1"
  $latestExternalJson = Join-Path $RuntimeDir "latest-external-surface.json"
  $latestExternalMd = Join-Path $ReportDir "LATEST-phantomforce-external-surface.md"

  if (-not (Test-Path $scanScript)) {
    Add-Issue warn "external surface" "External scan script is missing: $scanScript"
    return [pscustomobject]@{
      attempted = $false
      overall = "missing"
      warnings = 0
      errors = 0
      report = ""
      detail = "Missing external scan script."
    }
  }

  try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scanScript -VaultRoot $VaultRoot | Out-Null
    if (-not (Test-Path $latestExternalJson)) {
      throw "External scan did not write latest JSON."
    }
    $external = Get-Content -Raw -LiteralPath $latestExternalJson | ConvertFrom-Json
    $warnings = @($external.findings | Where-Object { $_.level -eq "warn" }).Count
    $errors = @($external.findings | Where-Object { $_.level -eq "error" }).Count

    if ($errors -gt 0) {
      Add-Issue error "external surface" "External PhantomForce surface scan found $errors error(s)."
    } elseif ($warnings -gt 0) {
      Add-Issue warn "external surface" "External PhantomForce surface scan found $warnings warning(s)."
    }

    return [pscustomobject]@{
      attempted = $true
      overall = $external.overall
      warnings = $warnings
      errors = $errors
      report = $latestExternalMd
      json = $latestExternalJson
      detail = "Read-only external surface scan completed."
    }
  } catch {
    Add-Issue warn "external surface" "External PhantomForce surface scan failed: $($_.Exception.Message)"
    return [pscustomobject]@{
      attempted = $true
      overall = "failed"
      warnings = 1
      errors = 0
      report = $latestExternalMd
      json = $latestExternalJson
      detail = $_.Exception.Message
    }
  }
}

function Get-ConsolePopupSnapshot {
  $watchScript = Join-Path $PSScriptRoot "Invoke-ConsolePopupAudit.ps1"
  $latestPopupJson = Join-Path $RuntimeDir "latest-console-popups.json"
  $latestPopupMd = Join-Path $ReportDir "LATEST-console-popup-watch.md"

  if (-not (Test-Path $watchScript)) {
    Add-Issue warn "console popup" "Console popup watcher is missing: $watchScript"
    return [pscustomobject]@{
      attempted = $false
      overall = "missing"
      suspect_count = 0
      new_suspect_count = 0
      report = ""
      detail = "Missing watcher script."
    }
  }

  try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $watchScript -VaultRoot $VaultRoot | Out-Null
    if (-not (Test-Path $latestPopupJson)) {
      throw "Console popup watcher did not write latest JSON."
    }
    $popup = Get-Content -Raw -LiteralPath $latestPopupJson | ConvertFrom-Json
    if ($popup.new_suspect_count -gt 0) {
      Add-Issue warn "console popup" "$($popup.new_suspect_count) new console popup suspect(s) appeared since the last watch run."
    } elseif ($popup.suspect_count -gt 0) {
      Add-Issue info "console popup" "$($popup.suspect_count) active console popup suspect(s) are being watched."
    }

    return [pscustomobject]@{
      attempted = $true
      overall = $popup.overall
      suspect_count = $popup.suspect_count
      new_suspect_count = $popup.new_suspect_count
      new_suspects = @($popup.new_suspects | Select-Object -First 8)
      report = $latestPopupMd
      json = $latestPopupJson
      detail = "Console popup watcher completed."
    }
  } catch {
    Add-Issue warn "console popup" "Console popup watcher failed: $($_.Exception.Message)"
    return [pscustomobject]@{
      attempted = $true
      overall = "failed"
      suspect_count = 0
      new_suspect_count = 0
      report = $latestPopupMd
      json = $latestPopupJson
      detail = $_.Exception.Message
    }
  }
}

function Write-Reports {
  param([object]$Report)

  $jsonPath = Join-Path $RuntimeDir "$Stamp-$Mode.json"
  $latestJson = Join-Path $RuntimeDir "latest.json"
  $mdPath = Join-Path $ReportDir "$Today-master-pc-health.md"
  $latestMd = Join-Path $ReportDir "LATEST-master-pc-health.md"

  $Report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $jsonPath -Encoding UTF8
  $Report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $latestJson -Encoding UTF8

  $warns = @($Report.issues | Where-Object { $_.level -eq "warn" }).Count
  $errors = @($Report.issues | Where-Object { $_.level -eq "error" }).Count
  $issueLines = if (@($Report.issues).Count) {
    ($Report.issues | ForEach-Object { "- [$($_.level)] $($_.area): $($_.message)" }) -join "`n"
  } else {
    "- No issues detected."
  }
  $endpointLines = ($Report.endpoints.checks | ForEach-Object {
    "- $($_.name): $($_.status) in $($_.ms)ms"
  }) -join "`n"
  $portLines = ($Report.ports.listeners | ForEach-Object {
    "- $($_.port): $($_.process) ($($_.pid))"
  }) -join "`n"
  if (-not $portLines) { $portLines = "- No watched ports listening." }
  $externalLine = if ($Report.external_surface.attempted) {
    "- Overall: $($Report.external_surface.overall)`n- Warnings: $($Report.external_surface.warnings)`n- Errors: $($Report.external_surface.errors)`n- Report: $($Report.external_surface.report)"
  } else {
    "- Not run in this mode."
  }
  $consoleStartupNames = @($Report.console_audit.console_startup_entries | Select-Object -First 8 -ExpandProperty name) -join ", "
  if (-not $consoleStartupNames) { $consoleStartupNames = "None detected." }
  $visibleTaskNames = @($Report.console_audit.visible_shell_scheduled_tasks | Select-Object -First 8 -ExpandProperty TaskName) -join ", "
  if (-not $visibleTaskNames) { $visibleTaskNames = "None detected." }
  $popupLine = if ($Report.console_popup.attempted) {
    "- Popup watcher: $($Report.console_popup.overall)`n- Active popup suspects: $($Report.console_popup.suspect_count)`n- New popup suspects: $($Report.console_popup.new_suspect_count)`n- Popup report: $($Report.console_popup.report)"
  } else {
    "- Popup watcher did not run."
  }
  $consoleLine = @"
- Shell process count: $($Report.console_audit.shell_process_count)
- Long-running dev/server shells: $($Report.console_audit.long_running_dev_shell_count)
- Startup items that can flash a console: $consoleStartupNames
- Scheduled tasks that may show a shell: $visibleTaskNames
$popupLine
"@

  $markdown = @"
# Master PC Health - $($Report.started_at)

Mode: $($Report.mode)
Overall: $($Report.overall)
Warnings: $warns
Errors: $errors

## Master Snapshot
- Computer: $($Report.system.computer)
- User: $($Report.system.user)
- Uptime: $($Report.system.uptime_hours) hours
- Memory: $($Report.system.memory_used_pct)% used ($($Report.system.memory_free) free)
- Admin shell: $($Report.system.is_admin_shell)

## Issues
$issueLines

## PhantomForce Endpoints
$endpointLines

## Watched Ports
$portLines

## Console / Startup Audit
$consoleLine

## Security
- Defender quick scan attempted: $($Report.defender.quick_scan.attempted)
- Defender quick scan result: $($Report.defender.quick_scan.ok)
- ClamAV installed: $($Report.clamav.installed)

## External PhantomForce Surface
$externalLine

## Files
- JSON: $jsonPath
- Latest JSON: $latestJson

No plaintext passwords, API keys, cookies, or tokens are written by this report.
"@

  $markdown | Set-Content -LiteralPath $mdPath -Encoding UTF8
  $markdown | Set-Content -LiteralPath $latestMd -Encoding UTF8

  return [pscustomobject]@{
    json = $jsonPath
    latest_json = $latestJson
    markdown = $mdPath
    latest_markdown = $latestMd
  }
}

$system = Get-SystemSnapshot
$disks = Get-DiskSnapshot
$processes = Get-ProcessSnapshot
$consoleAudit = Get-ConsoleStartupAudit
$ports = Get-PortSnapshot
$endpoints = Get-EndpointSnapshot
$defender = Get-DefenderSnapshot
$clamav = Get-ClamAvSnapshot
$git = Get-GitSnapshot
$externalSurface = Get-ExternalSurfaceSnapshot
$consolePopup = Get-ConsolePopupSnapshot

$EndedAt = Get-Date
$durationSec = [math]::Round([double]((New-TimeSpan -Start $StartedAt -End $EndedAt).TotalSeconds), 2)
$errorCount = @($Issues | Where-Object { $_.level -eq "error" }).Count
$warnCount = @($Issues | Where-Object { $_.level -eq "warn" }).Count
$overall = if ($errorCount -gt 0) { "attention_required" } elseif ($warnCount -gt 0) { "watch" } else { "healthy" }

$report = New-Object System.Collections.Specialized.OrderedDictionary
$report["started_at"] = $StartedAt.ToString("o")
$report["ended_at"] = $EndedAt.ToString("o")
$report["duration_sec"] = $durationSec
$report["mode"] = $Mode
$report["overall"] = $overall
$report["repo_root"] = $RepoRoot
$report["system"] = $system
$report["disks"] = $disks
$report["processes"] = $processes
$report["console_audit"] = $consoleAudit
$report["ports"] = $ports
$report["endpoints"] = $endpoints
$report["defender"] = $defender
$report["clamav"] = $clamav
$report["git"] = $git
$report["external_surface"] = $externalSurface
$report["console_popup"] = $consolePopup
$report["issues"] = [object[]]$Issues.ToArray()

$files = Write-Reports -Report $report

[pscustomobject]@{
  ok = ($overall -ne "attention_required")
  overall = $overall
  warnings = $warnCount
  errors = $errorCount
  mode = $Mode
  duration_sec = $report.duration_sec
  report = $files.latest_markdown
  json = $files.latest_json
}
