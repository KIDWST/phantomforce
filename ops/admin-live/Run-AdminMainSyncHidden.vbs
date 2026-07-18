Option Explicit

Dim fso
Dim shell
Dim scriptDir
Dim repoRoot
Dim syncScript
Dim powershell
Dim command

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
repoRoot = fso.GetParentFolderName(fso.GetParentFolderName(scriptDir))
syncScript = scriptDir & "\Sync-AdminMain.ps1"
powershell = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
command = """" & powershell & """ -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & syncScript & """ -RepoRoot """ & repoRoot & """ -Port 5177 -HermesPort 5190"

shell.Run command, 0, True
