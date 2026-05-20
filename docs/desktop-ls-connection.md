# Desktop LS Connection — Technical Documentation

## Overview

Antigravity Desktop Monitor connects to the **Antigravity Desktop App**'s Language Server (LS) process to capture real-time data (conversations, user status, model quotas, etc.). This document explains the complete connection mechanism.

---

## Architecture

```
+----------------------------+       RPC (HTTPS)       +---------------------------+
|  Desktop Monitor           | <---------------------> |  language_server.exe      |
|  (Neutralinojs)            |    Connect-RPC (JSON)   |  (Antigravity Desktop LS) |
|  poll.ps1 → curl.exe       |                         |  --standalone mode        |
+----------------------------+                         +---------------------------+
```

- **Desktop Monitor**: Neutralinojs app, uses PowerShell + `curl.exe` for process discovery and RPC calls
- **Language Server**: `language_server.exe` launched by the Antigravity Desktop App in `--standalone` mode
- **Protocol**: Connect-RPC (HTTP/2 over HTTPS, JSON encoding)

---

## Step 1: Process Discovery

The Desktop App spawns `language_server.exe` with specific command-line arguments:

```
language_server.exe --api_server_url https://server-url --manager_dir <path> --standalone --csrf_token <token> ...
```

### Key differences from IDE version:
| Attribute | IDE (VS Code) | Desktop App |
|---|---|---|
| Binary name | `language_server_windows_x64.exe` | `language_server.exe` |
| Identification | No `--standalone` flag | Has `--standalone` flag |
| Launch method | VS Code extension spawns it | Desktop App spawns it |

### Discovery code (PowerShell):

```powershell
# Find the desktop LS process
$proc = Get-CimInstance Win32_Process -Filter "Name='language_server.exe'" |
    Where-Object { $_.CommandLine -match '--standalone' } |
    Select-Object -First 1

# Extract CSRF token from command line
if ($proc.CommandLine -match '--csrf_token\s+(\S+)') {
    $csrf = $Matches[1]
}
```

---

## Step 2: Port Discovery

The LS listens on a random port on `127.0.0.1`. We find it via `netstat`:

```powershell
$pidVal = $proc.ProcessId
$netLines = netstat -ano | Where-Object {
    $_ -match 'LISTENING' -and $_.TrimEnd() -match "\s$pidVal$"
}
foreach ($line in $netLines) {
    if ($line -match '127\.0\.0\.1:(\d+)') {
        $port = $Matches[1]
        break
    }
}
```

Typically the LS binds to a port in the range 1024-65535 (random). The first `LISTENING` port for the PID is the RPC endpoint.

---

## Step 3: RPC Protocol

### Connection Parameters:
- **URL**: `https://127.0.0.1:<port>`
- **Certificate**: Self-signed (must use `-k` / `rejectUnauthorized: false`)
- **Protocol**: Connect-RPC (unary, JSON)
- **Content-Type**: `application/json`

### Required Headers:
| Header | Value | Purpose |
|---|---|---|
| `Content-Type` | `application/json` | Request body format |
| `Connect-Protocol-Version` | `1` | Connect-RPC version |
| `x-codeium-csrf-token` | `<extracted token>` | CSRF protection |

### Request Body:
All endpoints accept a metadata object:

```json
{
  "metadata": {
    "ideName": "antigravity",
    "extensionName": "antigravity",
    "ideVersion": "unknown",
    "locale": "en"
  }
}
```

### Example `curl` call:
```bash
curl.exe -k -s -X POST \
  "https://127.0.0.1:$port/exa.language_server_pb.LanguageServerService/GetUserStatus" \
  -H "Content-Type: application/json" \
  -H "Connect-Protocol-Version: 1" \
  -H "x-codeium-csrf-token: $csrf" \
  -d @body.json
```

---

## Step 4: Available RPC Endpoints

All endpoints are under the service path: `exa.language_server_pb.LanguageServerService/`

### GetUserStatus
Returns user account info, plan, credits, model configs, and quotas.

**Response structure (key fields):**
```
userStatus
├── name: "Moon"
├── email: "user@example.com"
├── planStatus
│   ├── planInfo
│   │   ├── planName: "Pro"
│   │   ├── teamsTier: "TEAMS_TIER_PRO"
│   │   ├── monthlyPromptCredits: 50000
│   │   └── monthlyFlowCredits: 150000
│   ├── availablePromptCredits: 500
│   └── availableFlowCredits: 100
├── cascadeModelConfigData
│   └── clientModelConfigs[]
│       ├── label: "Gemini 3.5 Flash (High)"
│       ├── quotaInfo
│       │   ├── remainingFraction: 1.0
│       │   └── resetTime: "2026-05-20T07:00:06Z"
│       └── supportedMimeTypes: {...}
├── userTier
│   ├── id: "g1-ultra-tier"
│   ├── name: "Google AI Ultra"
│   └── availableCredits[]
│       ├── creditType: "GOOGLE_ONE_AI"
│       └── creditAmount: "25000"
└── acceptedLatestTermsOfService: true
```

### GetAllCascadeTrajectories
Returns all conversation trajectories (chat sessions).

**Response structure:**
```
trajectories[]
├── cascadeId: "uuid"
├── title: "Conversation Title"
├── cascadeStatus: "CASCADE_STATUS_IDLE" | "CASCADE_STATUS_RUNNING" | ...
├── stepCount: 15
├── model: "model-name"
└── selectedModel: "model-alias"
```

### GetCascadeTrajectorySteps (per conversation)
Returns detailed steps for a specific conversation.

**Request body:**
```json
{
  "metadata": {...},
  "cascadeId": "<uuid>"
}
```

**Response contains:** Each step's `inputTokens`, `outputTokens`, `thinkingTokens`, `retryErrors`, model used, timestamps, etc.

---

## Step 5: Data Refresh Strategy

- **Poll interval**: 5 seconds
- **Non-blocking**: Uses `spawnProcess` (Neutralinojs) so UI remains responsive during PowerShell execution
- **Error handling**: If LS process disappears, gracefully shows "not detected" state
- **Deduplication**: `isPolling` flag prevents concurrent poll requests

---

## Implementation Notes

### Why PowerShell + curl.exe?
Neutralinojs runs in a WebView context (no Node.js). HTTPS to localhost with self-signed certs isn't possible via `fetch()`. We use:
- **PowerShell**: Process discovery (WMI) + port lookup (netstat)
- **curl.exe**: RPC calls with `-k` flag to skip cert validation

Both are built into Windows 10/11, no additional dependencies.

### Why temp file for JSON body?
PowerShell mangles JSON quotes when passing via `-d` argument. We write the body to a temp file and use `curl -d @file` syntax.

### Shared Protocol with IDE Plugin
The Desktop App LS uses the **exact same RPC protocol** as the IDE LS. The only differences are:
1. Binary name (`language_server.exe` vs `language_server_windows_x64.exe`)
2. Process identification (`--standalone` flag)
3. Port discovery method (same technique, different PID filtering)

All response structures, endpoints, and data formats are identical.

---

## File Structure

```
desktop-monitor/
├── neutralino.config.json       # Neutralinojs config
├── resources/
│   ├── index.html               # UI layout
│   ├── styles.css               # Dark theme styles
│   ├── poll.ps1                 # PowerShell polling script (standalone)
│   └── js/
│       ├── main.js              # App logic (discovery, render, tray)
│       └── neutralino.js        # Neutralinojs client library
├── bin/                         # Neutralinojs runtime binaries
└── dist/                        # Build output
    └── AntigravityDesktopMonitor/
        ├── AntigravityDesktopMonitor-win_x64.exe  (~1.6MB)
        └── resources.neu                          (~0.3MB)
```
