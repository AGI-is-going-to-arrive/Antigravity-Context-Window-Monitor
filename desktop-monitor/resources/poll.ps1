# poll.ps1 — Discovers desktop Antigravity LS and fetches data via curl.exe
# Output is structured text parsed by the JS frontend.
$ErrorActionPreference = 'SilentlyContinue'

$proc = Get-CimInstance Win32_Process -Filter "Name='language_server.exe'" |
    Where-Object { $_.CommandLine -match '--standalone' } |
    Select-Object -First 1

if (-not $proc) {
    Write-Output '{"connected":false}'
    exit
}

$csrf = $null
if ($proc.CommandLine -match '--csrf_token\s+(\S+)') {
    $csrf = $Matches[1]
}
if (-not $csrf) {
    Write-Output '{"connected":false}'
    exit
}

$pidVal = $proc.ProcessId

# Find first LISTENING port for this PID
$port = $null
$netLines = netstat -ano | Where-Object { $_ -match 'LISTENING' -and $_.TrimEnd() -match "\s$pidVal$" }
foreach ($line in $netLines) {
    if ($line -match '127\.0\.0\.1:(\d+)') {
        $port = $Matches[1]
        break
    }
}

if (-not $port) {
    Write-Output '{"connected":false}'
    exit
}

$body = '{"metadata":{"ideName":"antigravity","extensionName":"antigravity","ideVersion":"unknown","locale":"en"}}'
$bodyFile = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($bodyFile, $body)

$traj = & curl.exe -k -s --max-time 5 -X POST "https://127.0.0.1:$port/exa.language_server_pb.LanguageServerService/GetAllCascadeTrajectories" -H "Content-Type: application/json" -H "Connect-Protocol-Version: 1" -H "x-codeium-csrf-token: $csrf" -d "@$bodyFile" 2>$null

$status = & curl.exe -k -s --max-time 5 -X POST "https://127.0.0.1:$port/exa.language_server_pb.LanguageServerService/GetUserStatus" -H "Content-Type: application/json" -H "Connect-Protocol-Version: 1" -H "x-codeium-csrf-token: $csrf" -d "@$bodyFile" 2>$null

Remove-Item $bodyFile -Force -ErrorAction SilentlyContinue

# Output structured result
Write-Output "---BEGIN---"
Write-Output "PID=$pidVal"
Write-Output "PORT=$port"
Write-Output "---TRAJ---"
Write-Output $traj
Write-Output "---STATUS---"
Write-Output $status
Write-Output "---END---"
