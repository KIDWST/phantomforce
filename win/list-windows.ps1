# list-windows.ps1
# Emits the open application windows on this machine as JSON. "Open windows" =
# processes that own a visible main window with a title (what you see on the
# taskbar / Alt-Tab). Read-only.

$ErrorActionPreference = "Stop"

$procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle }

$list = foreach ($p in $procs) {
    [pscustomobject]@{
        pid        = $p.Id
        name       = $p.ProcessName
        title      = $p.MainWindowTitle
        memMB      = [math]::Round($p.WorkingSet64 / 1MB, 1)
        responding = [bool]$p.Responding
        handle     = [int64]$p.MainWindowHandle
    }
}

$sorted = @($list | Sort-Object name, title)

@{
    ok      = $true
    count   = $sorted.Count
    windows = $sorted
} | ConvertTo-Json -Depth 4 -Compress
