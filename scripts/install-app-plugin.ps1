# Cross-platform PowerShell installer wrapper for Antigravity Context Monitor App Plugin (Windows).
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$InstallerArgs
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallerMjs = Join-Path $ScriptDir 'install-app-plugin.mjs'

function Find-NodeExecutable {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }
    $candidates = @(
        (Join-Path $env:APPDATA 'Antigravity\bin\agy-node.cmd'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Antigravity\bin\agy-node.cmd'),
        (Join-Path $env:USERPROFILE '.gemini\antigravity\bin\agy-node.cmd')
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }
    return $null
}

$NodeBin = Find-NodeExecutable
if (-not $NodeBin) {
    Write-Error 'Node.js was not found on PATH and Antigravity bundled agy-node was not found.'
    exit 1
}

& $NodeBin $InstallerMjs @InstallerArgs
exit $LASTEXITCODE
