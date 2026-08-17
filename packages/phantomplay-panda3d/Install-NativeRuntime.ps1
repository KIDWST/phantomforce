param(
  [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$venv = Join-Path $root ".venv"

if (-not (Test-Path (Join-Path $venv "Scripts\python.exe"))) {
  & $Python -m venv $venv
  if ($LASTEXITCODE -ne 0) {
    throw "Could not create the PhantomPlay native virtual environment with $Python."
  }
}

$venvPython = Join-Path $venv "Scripts\python.exe"
& $venvPython -m pip install --disable-pip-version-check --upgrade pip
& $venvPython -m pip install --disable-pip-version-check -e $root
& $venvPython -c "import panda3d; print('PhantomPlay native runtime ready: Panda3D ' + panda3d.__version__)"
