# Cross-platform PowerShell installer wrapper for Antigravity Context Monitor App Plugin (Windows).
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$InstallerArgs
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallerMjs = Join-Path $ScriptDir 'install-app-plugin.mjs'

if (-not (Test-Path -LiteralPath $InstallerMjs)) {
    Write-Error "Installer script not found at $InstallerMjs"
    exit 1
}

function Add-CandidatePath {
    param(
        [System.Collections.Generic.List[string]]$List,
        [string]$BaseDir,
        [string]$RelativePath
    )
    if ($BaseDir -and $BaseDir.Trim()) {
        $List.Add((Join-Path $BaseDir $RelativePath))
    }
}

function Find-NodeRuntime {
    foreach ($cmdName in @('node', 'agy-node')) {
        $cmd = Get-Command $cmdName -ErrorAction SilentlyContinue
        if ($cmd) {
            return @{ Path = $cmd.Source; RunAsNode = $false }
        }
    }

    $candidates = [System.Collections.Generic.List[string]]::new()
    Add-CandidatePath $candidates $env:LOCALAPPDATA 'Programs\Antigravity\bin\agy-node.exe'
    Add-CandidatePath $candidates $env:LOCALAPPDATA 'Programs\Antigravity\bin\agy-node.cmd'
    Add-CandidatePath $candidates $env:LOCALAPPDATA 'Programs\Antigravity\resources\bin\agy-node.exe'
    Add-CandidatePath $candidates $env:LOCALAPPDATA 'Programs\Antigravity\resources\bin\agy-node.cmd'
    Add-CandidatePath $candidates $env:LOCALAPPDATA 'Programs\Antigravity\resources\bin\node.exe'
    Add-CandidatePath $candidates $env:ProgramFiles 'Antigravity\bin\agy-node.exe'
    Add-CandidatePath $candidates $env:ProgramFiles 'Antigravity\bin\agy-node.cmd'
    Add-CandidatePath $candidates $env:ProgramFiles 'Antigravity\resources\bin\agy-node.exe'
    Add-CandidatePath $candidates $env:APPDATA 'Antigravity\bin\agy-node.exe'
    Add-CandidatePath $candidates $env:APPDATA 'Antigravity\bin\agy-node.cmd'
    Add-CandidatePath $candidates $env:USERPROFILE '.gemini\bin\agy-node.exe'
    Add-CandidatePath $candidates $env:USERPROFILE '.gemini\bin\agy-node.cmd'
    Add-CandidatePath $candidates $env:USERPROFILE '.gemini\antigravity\bin\agy-node.exe'
    Add-CandidatePath $candidates $env:USERPROFILE '.gemini\antigravity\bin\agy-node.cmd'

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return @{ Path = $candidate; RunAsNode = $false }
        }
    }

    $electronCandidates = [System.Collections.Generic.List[string]]::new()
    Add-CandidatePath $electronCandidates $env:LOCALAPPDATA 'Programs\Antigravity\Antigravity.exe'
    Add-CandidatePath $electronCandidates $env:ProgramFiles 'Antigravity\Antigravity.exe'

    foreach ($exe in $electronCandidates) {
        if ($exe -and (Test-Path -LiteralPath $exe)) {
            return @{ Path = $exe; RunAsNode = $true }
        }
    }

    return $null
}

$Runtime = Find-NodeRuntime
if (-not $Runtime) {
    Write-Error 'Node.js was not found on PATH and Antigravity bundled agy-node / Electron runtime was not found.'
    exit 1
}

if ($Runtime.RunAsNode) {
    $prevRunAsNode = $env:ELECTRON_RUN_AS_NODE
    $env:ELECTRON_RUN_AS_NODE = '1'
    try {
        & $Runtime.Path $InstallerMjs @InstallerArgs
        $code = $LASTEXITCODE
    } finally {
        if ($null -eq $prevRunAsNode) {
            Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
        } else {
            $env:ELECTRON_RUN_AS_NODE = $prevRunAsNode
        }
    }
    exit $code
}

& $Runtime.Path $InstallerMjs @InstallerArgs
exit $LASTEXITCODE
