[CmdletBinding()]
param(
  [ValidateSet("status", "control")]
  [string]$Action = "status",

  [string]$SessionId = "",

  [ValidateSet("play-pause", "previous", "next")]
  [string]$Command = "play-pause"
)

$ErrorActionPreference = "Stop"

function Write-Result([hashtable]$Result) {
  $Result | ConvertTo-Json -Depth 6 -Compress
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime

  function Await-Operation($Operation, [Type]$ResultType) {
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
      Where-Object {
        $_.Name -eq "AsTask" -and
        $_.IsGenericMethod -and
        $_.GetParameters().Count -eq 1
      } |
      Select-Object -First 1

    if (-not $asTask) {
      throw "Windows Runtime task adapter is unavailable."
    }

    $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.Wait()
    return $task.Result
  }

  $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
  $propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
  $manager = Await-Operation ($managerType::RequestAsync()) $managerType
  $sessions = @($manager.GetSessions())
  $currentSession = $manager.GetCurrentSession()

  $processPlayers = @()
  $playerSpecs = @(
    @{ Process = "vlc"; App = "VLC" },
    @{ Process = "wmplayer"; App = "Media Player" },
    @{ Process = "Microsoft.Media.Player"; App = "Media Player" },
    @{ Process = "Music.UI"; App = "Media Player" },
    @{ Process = "Microsoft.ZuneMusic"; App = "Media Player" }
  )
  foreach ($spec in $playerSpecs) {
    $running = Get-Process -Name $spec.Process -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $running) { continue }
    $windowTitle = [string]$running.MainWindowTitle
    if ($windowTitle -match "(?i)\s+-\s+VLC media player$") {
      $windowTitle = $windowTitle -replace "(?i)\s+-\s+VLC media player$", ""
    }
    if (-not $windowTitle) { $windowTitle = "$($spec.App) is open" }
    $processPlayers += [ordered]@{
      id = "process:$($spec.Process):$($running.Id)"
      session_id = "process:$($spec.Process):$($running.Id)"
      app = $spec.App
      title = $windowTitle
      artist = ""
      album = ""
      playback_status = "Open"
      playing = $false
      process_fallback = $true
      controls = [ordered]@{ play_pause = $true; previous = $true; next = $true }
    }
  }

  if ($Action -eq "control") {
    $target = $null
    if ($SessionId) {
      $target = $sessions | Where-Object { $_.SourceAppUserModelId -eq $SessionId } | Select-Object -First 1
    }
    if (-not $target) {
      $target = $currentSession
    }
    if (-not $target -and ($SessionId -match "^process:" -or $processPlayers.Count -gt 0)) {
      if (-not ("PhantomForceMediaKeys" -as [type])) {
        Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PhantomForceMediaKeys {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
}
"@
      }
      $virtualKey = switch ($Command) {
        "previous" { 0xB1 }
        "next" { 0xB0 }
        default { 0xB3 }
      }
      [PhantomForceMediaKeys]::keybd_event([byte]$virtualKey, 0, 0, [UIntPtr]::Zero)
      [PhantomForceMediaKeys]::keybd_event([byte]$virtualKey, 0, 2, [UIntPtr]::Zero)
      Write-Result @{
        ok = $true
        reason = ""
        source = "windows_media_key"
        session_id = $SessionId
        command = $Command
      }
      exit 0
    }
    if (-not $target) {
      Write-Result @{ ok = $false; reason = "no_active_media"; source = "windows_media_session" }
      exit 0
    }

    $playback = $target.GetPlaybackInfo()
    $operation = switch ($Command) {
      "previous" { $target.TrySkipPreviousAsync() }
      "next" { $target.TrySkipNextAsync() }
      default {
        if ([string]$playback.PlaybackStatus -eq "Playing") {
          $target.TryPauseAsync()
        } else {
          $target.TryPlayAsync()
        }
      }
    }
    $accepted = Await-Operation $operation ([bool])
    Write-Result @{
      ok = [bool]$accepted
      reason = $(if ($accepted) { "" } else { "command_not_supported" })
      source = "windows_media_session"
      session_id = [string]$target.SourceAppUserModelId
      command = $Command
    }
    exit 0
  }

  $items = @()
  foreach ($mediaSession in $sessions) {
    try {
      $playback = $mediaSession.GetPlaybackInfo()
      $controls = $playback.Controls
      $properties = Await-Operation ($mediaSession.TryGetMediaPropertiesAsync()) $propertiesType
      $sourceId = [string]$mediaSession.SourceAppUserModelId
      $app = if ($sourceId -match "(?i)vlc") {
        "VLC"
      } elseif ($sourceId -match "(?i)(zunemusic|mediaplayer|wmplayer)") {
        "Media Player"
      } elseif ($sourceId -match "(?i)brave") {
        "Brave"
      } elseif ($sourceId -match "(?i)chrome") {
        "Chrome"
      } elseif ($sourceId -match "(?i)msedge") {
        "Edge"
      } elseif ($sourceId) {
        [System.IO.Path]::GetFileNameWithoutExtension($sourceId)
      } else {
        "Media"
      }

      $title = [string]$properties.Title
      $artist = [string]$properties.Artist
      if (-not $title) { $title = [string]$properties.AlbumTitle }
      if (-not $title) { $title = "$app media" }

      $items += [ordered]@{
        id = $sourceId
        session_id = $sourceId
        app = $app
        title = $title
        artist = $artist
        album = [string]$properties.AlbumTitle
        playback_status = [string]$playback.PlaybackStatus
        playing = ([string]$playback.PlaybackStatus -eq "Playing")
        controls = [ordered]@{
          play_pause = [bool]($controls.IsPlayEnabled -or $controls.IsPauseEnabled -or $controls.IsPlayPauseToggleEnabled)
          previous = [bool]$controls.IsPreviousEnabled
          next = [bool]$controls.IsNextEnabled
        }
      }
    } catch {
      # One broken player session should not hide other healthy sessions.
    }
  }

  foreach ($processPlayer in $processPlayers) {
    if (-not ($items | Where-Object { $_.app -eq $processPlayer.app })) {
      $items += $processPlayer
    }
  }

  $currentId = if ($currentSession) { [string]$currentSession.SourceAppUserModelId } else { "" }
  $activeItem = $items | Where-Object { $_.playing } | Select-Object -First 1
  if (-not $activeItem -and $currentId) {
    $activeItem = $items | Where-Object { $_.session_id -eq $currentId } | Select-Object -First 1
  }
  if (-not $activeItem) { $activeItem = $items | Select-Object -First 1 }

  $statusResult = @{
    ok = $true
    source = "windows_media_session"
    sessions = @($items)
    collected_at = (Get-Date).ToUniversalTime().ToString("o")
  }
  if ($activeItem) { $statusResult.active = $activeItem }
  Write-Result $statusResult
} catch {
  Write-Result @{
    ok = $false
    source = "windows_media_session"
    reason = "windows_media_unavailable"
    message = "Windows media controls are unavailable on this host."
  }
}
