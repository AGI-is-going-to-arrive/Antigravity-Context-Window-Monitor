// ─── Antigravity Desktop Monitor — Neutralinojs Main ─────────────────────────

let lastData = { connected: false, trajectories: [], userStatus: null };
let pollTimer = null;
let windowVisible = false;
let pollScriptPath = null;

// Embedded PowerShell polling script
const POLL_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$proc = Get-CimInstance Win32_Process -Filter "Name='language_server.exe'" | Where-Object { $_.CommandLine -match '--standalone' } | Select-Object -First 1
if (-not $proc) { Write-Output '{"connected":false}'; exit }
$csrf = $null
if ($proc.CommandLine -match '--csrf_token\\s+(\\S+)') { $csrf = $Matches[1] }
if (-not $csrf) { Write-Output '{"connected":false}'; exit }
$pidVal = $proc.ProcessId
$port = $null
$netLines = netstat -ano | Where-Object { $_ -match 'LISTENING' -and $_.TrimEnd() -match "\\s$pidVal$" }
foreach ($line in $netLines) { if ($line -match '127\\.0\\.0\\.1:(\\d+)') { $port = $Matches[1]; break } }
if (-not $port) { Write-Output '{"connected":false}'; exit }
$body = '{"metadata":{"ideName":"antigravity","extensionName":"antigravity","ideVersion":"unknown","locale":"en"}}'
$bodyFile = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($bodyFile, $body)
$traj = & curl.exe -k -s --max-time 5 -X POST "https://127.0.0.1:$port/exa.language_server_pb.LanguageServerService/GetAllCascadeTrajectories" -H "Content-Type: application/json" -H "Connect-Protocol-Version: 1" -H "x-codeium-csrf-token: $csrf" -d "@$bodyFile" 2>$null
$status = & curl.exe -k -s --max-time 5 -X POST "https://127.0.0.1:$port/exa.language_server_pb.LanguageServerService/GetUserStatus" -H "Content-Type: application/json" -H "Connect-Protocol-Version: 1" -H "x-codeium-csrf-token: $csrf" -d "@$bodyFile" 2>$null
Remove-Item $bodyFile -Force -ErrorAction SilentlyContinue
Write-Output "---BEGIN---"
Write-Output "PID=$pidVal"
Write-Output "PORT=$port"
Write-Output "---TRAJ---"
Write-Output $traj
Write-Output "---STATUS---"
Write-Output $status
Write-Output "---END---"
`.trim();

// Write poll script to temp file on startup
async function initPollScript() {
    const tempDir = await Neutralino.os.getEnv('TEMP');
    pollScriptPath = tempDir + '\\ag_monitor_poll.ps1';
    await Neutralino.filesystem.writeFile(pollScriptPath, POLL_SCRIPT);
}

// ── LS Discovery + Data Fetch (non-blocking via spawnProcess) ──
let isPolling = false;

async function pollData() {
    if (isPolling) return; // skip if previous poll still running
    isPolling = true;

    try {
        if (!pollScriptPath) await initPollScript();

        const proc = await Neutralino.os.spawnProcess(
            `powershell -NoProfile -ExecutionPolicy Bypass -File "${pollScriptPath}"`
        );

        let output = '';

        // Accumulate output from spawned process
        const handler = (evt) => {
            if (evt.detail.id !== proc.id) return;

            if (evt.detail.action === 'stdOut') {
                output += evt.detail.data;
            } else if (evt.detail.action === 'exit') {
                // Process finished — parse and render
                Neutralino.events.off('spawnedProcess', handler);
                isPolling = false;
                parseAndRender(output.trim());
            }
        };

        Neutralino.events.on('spawnedProcess', handler);

        // Safety timeout — if process hangs, reset polling flag
        setTimeout(() => {
            if (isPolling) {
                Neutralino.events.off('spawnedProcess', handler);
                isPolling = false;
            }
        }, 15000);

    } catch (e) {
        console.error('Poll error:', e);
        isPolling = false;
        lastData = { connected: false, trajectories: [], userStatus: null };
        renderData(lastData);
        updateTray(false);
    }
}

function parseAndRender(output) {
    if (!output || output.startsWith('{"connected":false}')) {
        lastData = { connected: false, trajectories: [], userStatus: null };
        renderData(lastData);
        updateTray(false);
        return;
    }

    const beginIdx = output.indexOf('---BEGIN---');
    if (beginIdx === -1) {
        lastData = { connected: false, trajectories: [], userStatus: null };
        renderData(lastData);
        updateTray(false);
        return;
    }

    const content = output.substring(beginIdx + '---BEGIN---'.length);
    const pidMatch = content.match(/PID=(\d+)/);
    const portMatch = content.match(/PORT=(\d+)/);
    const pid = pidMatch ? parseInt(pidMatch[1]) : 0;
    const port = portMatch ? parseInt(portMatch[1]) : 0;

    let trajectories = [];
    let userStatus = null;

    const trajIdx = content.indexOf('---TRAJ---');
    const statusIdx = content.indexOf('---STATUS---');
    const endIdx = content.indexOf('---END---');

    if (trajIdx !== -1 && statusIdx !== -1) {
        const trajJson = content.substring(trajIdx + '---TRAJ---'.length, statusIdx).trim();
        const statusJson = content.substring(statusIdx + '---STATUS---'.length, endIdx !== -1 ? endIdx : undefined).trim();

        try {
            const trajData = JSON.parse(trajJson);
            trajectories = trajData.trajectories || [];
        } catch { /* ignore */ }

        try {
            userStatus = JSON.parse(statusJson);
        } catch { /* ignore */ }
    }

    lastData = { connected: true, pid, port, trajectories, userStatus };
    renderData(lastData);
    updateTray(lastData.connected);
}

// ── System Tray ──
async function setupTray(connected) {
    try {
        await Neutralino.os.setTray({
            icon: '/resources/icons/appIcon.png',
            menuItems: [
                { id: 'show', text: 'Show Panel' },
                { id: 'refresh', text: 'Refresh' },
                { id: 'sep', text: '-' },
                { id: 'quit', text: 'Quit' }
            ]
        });
    } catch (e) {
        console.error('Tray error:', e);
    }
}

function updateTray(connected) {
    setupTray(connected);
}

// ── Tray Menu Handler ──
async function onTrayMenuClick(event) {
    switch (event.detail.id) {
        case 'show':
            await showWindow();
            break;
        case 'refresh':
            await pollData();
            break;
        case 'quit':
            Neutralino.app.exit();
            break;
    }
}

// ── Window Management ──
async function showWindow() {
    try {
        await Neutralino.window.show();
        await Neutralino.window.focus();
        windowVisible = true;
    } catch (e) { console.error('Show window error:', e); }
}

async function hideWindow() {
    try {
        await Neutralino.window.hide();
        windowVisible = false;
    } catch (e) { console.error('Hide window error:', e); }
}

// ── Polling ──
function startPolling() {
    pollData();
    pollTimer = setInterval(pollData, 5000);
}

// ── UI Rendering ──
function formatNumber(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function statusLabel(status) {
    if (!status) return 'unknown';
    return status.replace('CASCADE_STATUS_', '').replace('CORTEX_STEP_STATUS_', '').toLowerCase();
}

const $ = (sel) => document.querySelector(sel);

function renderData(data) {
    const statusDot = $('#status-dot');
    const statusText = $('#status-text');
    const emptyState = $('#empty-state');
    const userSection = $('#user-section');
    const activeSection = $('#active-section');
    const convSection = $('#conv-section');

    if (!data.connected) {
        statusDot.className = 'status-dot disconnected';
        statusText.textContent = 'Desktop App not detected';
        emptyState.style.display = 'flex';
        userSection.style.display = 'none';
        activeSection.style.display = 'none';
        convSection.style.display = 'none';
        return;
    }

    emptyState.style.display = 'none';
    statusDot.className = 'status-dot connected';
    statusText.textContent = `Connected \u00b7 PID ${data.pid} \u00b7 Port ${data.port}`;

    // User info
    const us = data.userStatus?.userStatus || data.userStatus || {};
    if (us && (us.name || us.email || us.planStatus)) {
        userSection.style.display = 'block';
        const planInfo = us.planStatus?.planInfo || {};
        const planName = planInfo.planName || 'Unknown';
        const email = us.email || '';
        const name = us.name || '';
        const googleTier = us.userTier?.name || '';

        let html = '';
        if (name) html += `<span class="info-label">Name</span><span class="info-value">${escapeHtml(name)}</span>`;
        if (email) html += `<span class="info-label">Email</span><span class="info-value">${escapeHtml(email)}</span>`;
        if (googleTier) {
            html += `<span class="info-label">Google AI</span><span class="info-value" style="color:#fbbf24;font-weight:700">${escapeHtml(googleTier)}</span>`;
        }
        html += `<span class="info-label">Plan</span><span class="info-value">${escapeHtml(planName)}</span>`;

        const promptCredits = us.planStatus?.availablePromptCredits;
        const flowCredits = us.planStatus?.availableFlowCredits;
        if (promptCredits !== undefined) {
            html += `<span class="info-label">Prompt Credits</span><span class="info-value">${formatNumber(promptCredits)}</span>`;
        }
        if (flowCredits !== undefined) {
            html += `<span class="info-label">Flow Credits</span><span class="info-value">${formatNumber(flowCredits)}</span>`;
        }
        const gCredits = us.userTier?.availableCredits;
        if (gCredits && gCredits.length > 0) {
            for (const c of gCredits) {
                const type = (c.creditType || '').replace('GOOGLE_ONE_AI', 'Google AI');
                html += `<span class="info-label">${escapeHtml(type)} Credits</span><span class="info-value">${formatNumber(Number(c.creditAmount))}</span>`;
            }
        }
        $('#user-info').innerHTML = html;
    } else {
        userSection.style.display = 'none';
    }

    // Model quotas
    const models = us?.cascadeModelConfigData?.clientModelConfigs || [];
    if (models.length > 0) {
        let modelSection = $('#model-section');
        if (!modelSection) {
            // Create model section dynamically
            const section = document.createElement('div');
            section.className = 'section';
            section.id = 'model-section';
            section.innerHTML = '<div class="section-header">Model Quotas</div><div id="model-list"></div>';
            convSection.parentNode.insertBefore(section, convSection);
            modelSection = section;
        }
        modelSection.style.display = 'block';
        const modelList = $('#model-list');
        modelList.innerHTML = models.map(m => {
            const frac = m.quotaInfo?.remainingFraction ?? 1;
            const pct = Math.round(frac * 100);
            const barClass = pct <= 20 ? 'critical' : pct <= 50 ? 'warning' : '';
            return `<div class="model-item">
                <div class="model-name">${escapeHtml(m.label)}</div>
                <div class="token-bar"><div class="token-bar-fill ${barClass}" style="width:${pct}%"></div></div>
                <div class="token-text"><span>${pct}% remaining</span></div>
            </div>`;
        }).join('');
    }

    // Trajectories
    const trajs = data.trajectories || [];
    if (trajs.length === 0) {
        activeSection.style.display = 'none';
        convSection.style.display = 'none';
        if (emptyState) {
            emptyState.style.display = 'flex';
            emptyState.querySelector('p').textContent = 'Connected, no conversations yet';
            emptyState.querySelector('.empty-hint').textContent = 'Start a conversation in the Desktop App';
        }
        return;
    }

    const running = trajs.find(t =>
        (t.cascadeStatus || '').includes('RUNNING') || (t.cascadeStatus || '').includes('STREAMING')
    );

    if (running) {
        activeSection.style.display = 'block';
        const steps = running.stepCount || 0;
        const title = running.title || `Conversation ${(running.cascadeId || '').substring(0, 8)}`;
        const model = running.model || running.selectedModel || '';
        $('#active-conv').innerHTML = `
            <div class="active-detail">
                <div class="conv-title">${escapeHtml(title)}</div>
                <div class="conv-meta" style="margin-top:6px;">
                    <span>Steps: ${steps}</span>
                    ${model ? `<span>Model: ${model}</span>` : ''}
                    <span class="conv-status running">RUNNING</span>
                </div>
            </div>`;
    } else {
        activeSection.style.display = 'none';
    }

    convSection.style.display = 'block';
    $('#conv-count').textContent = trajs.length;
    const listHtml = trajs.slice(0, 20).map(t => {
        const title = t.title || `Conversation ${(t.cascadeId || '').substring(0, 8)}`;
        const steps = t.stepCount || 0;
        const status = statusLabel(t.cascadeStatus);
        const isRunning = status === 'running' || status === 'streaming';
        const isActive = running && t.cascadeId === running.cascadeId;
        return `<div class="conv-card${isActive ? ' active' : ''}">
            <div class="conv-title">${escapeHtml(title)}</div>
            <div class="conv-meta">
                <span>Steps: ${steps}</span>
                <span class="conv-status ${isRunning ? 'running' : 'idle'}">${status.toUpperCase()}</span>
            </div>
        </div>`;
    }).join('');
    $('#conv-list').innerHTML = listHtml;

    // Auto-resize window to fit content
    autoResize();
}

// ── Auto-resize window to fit content ──
async function autoResize() {
    try {
        // Wait a frame for DOM to settle
        await new Promise(r => requestAnimationFrame(r));
        const contentHeight = document.body.scrollHeight;
        // Cap at 85% of screen height
        const maxH = Math.round(window.screen.availHeight * 0.85);
        const targetH = Math.min(contentHeight + 2, maxH);
        const currentSize = await Neutralino.window.getSize();
        // Only resize if height difference > 20px (avoid flicker)
        if (Math.abs(currentSize.height - targetH) > 20) {
            await Neutralino.window.setSize({ width: currentSize.width, height: targetH });
        }
    } catch { /* ignore resize errors */ }
}

// ── Initialize ──
Neutralino.init();

Neutralino.events.on('trayMenuItemClicked', onTrayMenuClick);

// When window close is requested (X button on native frame or Alt+F4),
// hide the window instead of exiting — keeps tray alive
Neutralino.events.on('windowClose', async () => {
    await hideWindow();
});

// Show window on start and begin polling
async function initWindow() {
    // 70% of screen resolution
    const w = Math.round(window.screen.availWidth * 0.7);
    const h = Math.round(window.screen.availHeight * 0.7);
    await Neutralino.window.setSize({ width: w, height: h, minWidth: 380, minHeight: 400 });
    await Neutralino.window.center();
    await showWindow();
    startPolling();
}
setupTray(false);
initWindow();

// Titlebar drag support — only the drag area, not buttons
Neutralino.window.setDraggableRegion('titlebar-drag');

// Titlebar buttons
document.getElementById('btn-refresh')?.addEventListener('click', (e) => {
    e.stopPropagation();
    pollData();
});
document.getElementById('btn-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideWindow();
});
