param(
  [ValidateSet('dev', 'test', 'build', 'preview', 'typecheck', 'inspect:jamie', 'inspect:jamie-variants', 'inspect:standard-ai')]
  [string]$Command = 'dev'
)

$ErrorActionPreference = 'Stop'
$taskProjectRoot = Split-Path -Parent $PSScriptRoot
$taskNodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($taskNodeCommand) {
  $taskNodeRoot = Split-Path -Parent $taskNodeCommand.Source
} else {
  $taskRuntimeFile = Join-Path $env:USERPROFILE '.codex\tools\fighting-arena-node\runtime-path.txt'
  if (-not (Test-Path -LiteralPath $taskRuntimeFile)) {
    throw 'Please install Node.js 22.12 or newer, then run this script again.'
  }
  $taskNodeRoot = (Get-Content -LiteralPath $taskRuntimeFile).Trim()
}
$env:Path = $taskNodeRoot + ';' + $env:Path
Push-Location -LiteralPath $taskProjectRoot
try {
  if (-not (Test-Path -LiteralPath 'node_modules')) {
    & (Join-Path $taskNodeRoot 'npm.cmd') ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  }
  & (Join-Path $taskNodeRoot 'npm.cmd') run $Command
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
