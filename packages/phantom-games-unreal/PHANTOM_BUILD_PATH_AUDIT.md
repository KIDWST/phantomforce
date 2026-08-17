# PHANTOM BUILD PATH AUDIT

This file is a placeholder until the installer/build runs on the Windows host.

Run:
`powershell -ExecutionPolicy Bypass -File Tools\Audit-PhantomBuildPaths.ps1`

The audit verifies the expected fresh build roots:
- `Builds\Windows\phantom-strike\PhantomStrike.exe`
- `Builds\Windows\phantom-ages\PhantomAges.exe`
- `Builds\Windows\phantom-legends\PhantomLegends.exe`
- `Builds\Windows\cubetown\Cubetown.exe`

The build script deletes stale archive/output folders before every package and writes `PHANTOM_FLAGSHIP_SCREEN_REBUILD_BUILD.txt` into each fresh output.
