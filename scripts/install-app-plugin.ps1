# Cross-platform PowerShell installer wrapper for Antigravity Context Monitor App Plugin (Windows).
# Preserve option/value pairs (including --local-dir paths) for the Node CLI.
$InstallerArgs = $args

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallerMjs = Join-Path $ScriptDir 'install-app-plugin.mjs'

if (-not (Test-Path -LiteralPath $InstallerMjs)) {
    Write-Error "Installer script not found at $InstallerMjs"
    exit 1
}

$MinNodeMajor = 22

function Add-CandidatePath {
    param(
        [System.Collections.Generic.List[string]]$List,
        [System.Collections.Generic.HashSet[string]]$Seen,
        [string]$BaseDir,
        [string]$RelativePath
    )
    if ($BaseDir -and $BaseDir.Trim()) {
        $full = Join-Path $BaseDir.Trim() $RelativePath
        if ($Seen.Add($full)) {
            $List.Add($full)
        }
    }
}

function Test-NodeRuntimeCompatible {
    param(
        [string]$CandidatePath,
        [bool]$RunAsNode = $false
    )
    if (-not $CandidatePath -or -not (Test-Path -LiteralPath $CandidatePath)) {
        return $false
    }
    $prevRunAsNode = $env:ELECTRON_RUN_AS_NODE
    try {
        if ($RunAsNode) {
            $env:ELECTRON_RUN_AS_NODE = '1'
        }
        # Let the native process exit before checking its result. An early
        # pipeline stop can leave LASTEXITCODE unset or from a previous tool.
        $versionLines = @(& $CandidatePath -v 2>$null)
        if ($LASTEXITCODE -ne 0 -or $versionLines.Count -eq 0) {
            return $false
        }
        if ($versionLines[0].ToString().Trim() -match '^v?(\d+)\.') {
            return ([int]$Matches[1] -ge $MinNodeMajor)
        }
        return $false
    } catch {
        return $false
    } finally {
        if ($RunAsNode) {
            if ($null -eq $prevRunAsNode) {
                Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
            } else {
                $env:ELECTRON_RUN_AS_NODE = $prevRunAsNode
            }
        }
    }
}

function Find-NodeRuntime {
    foreach ($cmdName in @('node', 'agy-node')) {
        $cmds = Get-Command $cmdName -All -ErrorAction SilentlyContinue
        foreach ($cmd in $cmds) {
            if ($cmd -and $cmd.Source -and (Test-NodeRuntimeCompatible -CandidatePath $cmd.Source -RunAsNode $false)) {
                return @{ Path = $cmd.Source; RunAsNode = $false }
            }
        }
    }

    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $candidates = [System.Collections.Generic.List[string]]::new()

    # Align install root discovery with src/app/cdp-launcher.ts:
    # %LOCALAPPDATA%, %ProgramFiles%, %ProgramFiles(x86)%, %ProgramW6432% (32-bit/64-bit PowerShell safe)
    Add-CandidatePath $candidates $seen $env:LOCALAPPDATA 'Programs\Antigravity\bin\agy-node.exe'
    Add-CandidatePath $candidates $seen $env:LOCALAPPDATA 'Programs\Antigravity\bin\agy-node.cmd'
    Add-CandidatePath $candidates $seen $env:LOCALAPPDATA 'Programs\Antigravity\resources\bin\agy-node.exe'
    Add-CandidatePath $candidates $seen $env:LOCALAPPDATA 'Programs\Antigravity\resources\bin\agy-node.cmd'
    Add-CandidatePath $candidates $seen $env:LOCALAPPDATA 'Programs\Antigravity\resources\bin\node.exe'
    Add-CandidatePath $candidates $seen $env:LOCALAPPDATA 'Antigravity\bin\agy-node.exe'
    Add-CandidatePath $candidates $seen $env:LOCALAPPDATA 'Antigravity\bin\agy-node.cmd'
    Add-CandidatePath $candidates $seen $env:LOCALAPPDATA 'Antigravity\resources\bin\agy-node.exe'
    Add-CandidatePath $candidates $seen $env:LOCALAPPDATA 'Antigravity\resources\bin\agy-node.cmd'
    Add-CandidatePath $candidates $seen $env:LOCALAPPDATA 'Antigravity\resources\bin\node.exe'

    $programFileRoots = @(
        $env:ProgramFiles,
        ${env:ProgramFiles(x86)},
        $env:ProgramW6432
    )
    foreach ($pfRoot in $programFileRoots) {
        foreach ($subRoot in @('Antigravity', 'Google\Antigravity')) {
            Add-CandidatePath $candidates $seen $pfRoot "$subRoot\bin\agy-node.exe"
            Add-CandidatePath $candidates $seen $pfRoot "$subRoot\bin\agy-node.cmd"
            Add-CandidatePath $candidates $seen $pfRoot "$subRoot\resources\bin\agy-node.exe"
            Add-CandidatePath $candidates $seen $pfRoot "$subRoot\resources\bin\agy-node.cmd"
            Add-CandidatePath $candidates $seen $pfRoot "$subRoot\resources\bin\node.exe"
        }
    }

    Add-CandidatePath $candidates $seen $env:APPDATA 'Antigravity\bin\agy-node.exe'
    Add-CandidatePath $candidates $seen $env:APPDATA 'Antigravity\bin\agy-node.cmd'
    Add-CandidatePath $candidates $seen $env:USERPROFILE '.gemini\bin\agy-node.exe'
    Add-CandidatePath $candidates $seen $env:USERPROFILE '.gemini\bin\agy-node.cmd'
    Add-CandidatePath $candidates $seen $env:USERPROFILE '.gemini\antigravity\bin\agy-node.exe'
    Add-CandidatePath $candidates $seen $env:USERPROFILE '.gemini\antigravity\bin\agy-node.cmd'

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-NodeRuntimeCompatible -CandidatePath $candidate -RunAsNode $false)) {
            return @{ Path = $candidate; RunAsNode = $false }
        }
    }

    $electronSeen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $electronCandidates = [System.Collections.Generic.List[string]]::new()
    Add-CandidatePath $electronCandidates $electronSeen $env:LOCALAPPDATA 'Programs\Antigravity\Antigravity.exe'
    Add-CandidatePath $electronCandidates $electronSeen $env:LOCALAPPDATA 'Antigravity\Antigravity.exe'
    foreach ($pfRoot in $programFileRoots) {
        Add-CandidatePath $electronCandidates $electronSeen $pfRoot 'Antigravity\Antigravity.exe'
        Add-CandidatePath $electronCandidates $electronSeen $pfRoot 'Google\Antigravity\Antigravity.exe'
    }

    foreach ($exe in $electronCandidates) {
        if ($exe -and (Test-NodeRuntimeCompatible -CandidatePath $exe -RunAsNode $true)) {
            return @{ Path = $exe; RunAsNode = $true }
        }
    }

    return $null
}

$Runtime = Find-NodeRuntime
if (-not $Runtime) {
    Write-Error "Node.js >= $MinNodeMajor was not found on PATH and Antigravity bundled agy-node / Electron runtime was not found."
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
