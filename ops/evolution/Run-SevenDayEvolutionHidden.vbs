Option Explicit

Dim shell, scriptPath, command, extra, waitForExit, exitCode
Set shell = CreateObject("WScript.Shell")

scriptPath = "C:\Users\jorda\Documents\Codex\worktrees\phantomforce-live-social-analytics-20260712\ops\evolution\Invoke-SevenDayEvolutionCycle.ps1"
extra = ""
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "--preflight-only" Then
    extra = " -PreflightOnly"
  End If
End If

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptPath & """" & extra
waitForExit = (extra <> "")
exitCode = shell.Run(command, 0, waitForExit)
If waitForExit Then
  WScript.Quit exitCode
End If
