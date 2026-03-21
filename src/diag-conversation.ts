#!/usr/bin/env npx ts-node
// ─── 对话数据诊断脚本 v2.0 ───────────────────────────────────────────────────
// 连接 LS，dump 指定对话步骤，分析模型归属差异
//
// 运行：npx ts-node src/diag-conversation.ts --title "Refining Knowledge"
//       npx ts-node src/diag-conversation.ts --title "Analyzing Data"
// 输出：diag-output/ 目录下的 .txt 报告 + .json 原始数据

import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const MAX_BODY = 50 * 1024 * 1024;
const OUT_DIR = path.join(__dirname, '..', 'diag-output');

// ─── 日志写入文件 ────────────────────────────────────────────────────────────

let logLines: string[] = [];
function log(msg: string) { logLines.push(msg); console.log(msg); }

function saveReport(name: string) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 60);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const reportPath = path.join(OUT_DIR, `${safeName}_${ts}.txt`);
    fs.writeFileSync(reportPath, logLines.join('\n'), 'utf-8');
    console.log(`\n📄 报告已保存: ${reportPath}`);
    return reportPath;
}

function saveJson(name: string, data: unknown) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 60);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const jsonPath = path.join(OUT_DIR, `${safeName}_${ts}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`📦 原始数据: ${jsonPath}`);
    return jsonPath;
}

// ─── LS 发现 ─────────────────────────────────────────────────────────────────

interface LSInfo { pid: number; csrfToken: string; port: number; useTls: boolean; }

function discoverLS(): { csrfToken: string; pid: number; ports: number[] } | null {
    let output = '';
    try {
        output = execSync(
            "wmic process where \"name like 'language_server_windows%'\" get ProcessId,CommandLine /format:csv",
            { encoding: 'utf-8', timeout: 5000 }
        );
    } catch {
        try {
            output = execSync(
                "powershell.exe -NoProfile -NoLogo -Command \"Get-CimInstance Win32_Process -Filter \\\"Name like 'language_server_windows%'\\\" | Select-Object ProcessId, CommandLine | ConvertTo-Csv -NoTypeInformation\"",
                { encoding: 'utf-8', timeout: 10000 }
            );
        } catch { return null; }
    }

    const lines = output.split('\n').filter(l => l.includes('language_server_windows') && l.includes('antigravity'));
    if (lines.length === 0) return null;

    const line = lines[0];
    const csrfMatch = line.match(/--csrf_token\s+([^\s]+)/);
    const pidMatch = line.match(/(\d+)\s*$/);
    if (!csrfMatch || !pidMatch) return null;

    const pid = parseInt(pidMatch[1], 10);
    const csrfToken = csrfMatch[1];

    // netstat 获取所有监听端口
    const netstat = execSync('netstat -ano', { encoding: 'utf-8', timeout: 5000 });
    const ports: number[] = [];
    const pidStr = String(pid);
    for (const nl of netstat.split('\n')) {
        if (nl.includes('LISTENING') && nl.trim().endsWith(pidStr)) {
            const pm = nl.match(/\s+127\.0\.0\.1:(\d+)\s/);
            if (pm) ports.push(parseInt(pm[1], 10));
        }
    }

    return { csrfToken, pid, ports };
}

// ─── RPC（支持端口+协议自动探测）────────────────────────────────────────────

function rpcCall(
    ls: LSInfo, endpoint: string, body: Record<string, unknown>, timeoutMs = 20000
): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(body);
        const transport = ls.useTls ? https : http;
        const req = transport.request({
            hostname: '127.0.0.1', port: ls.port,
            path: `/exa.language_server_pb.LanguageServerService/${endpoint}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Connect-Protocol-Version': '1',
                'x-codeium-csrf-token': ls.csrfToken,
                'Content-Length': Buffer.byteLength(postData),
            },
            timeout: timeoutMs, rejectUnauthorized: false,
        }, (res) => {
            let data = ''; let sz = 0;
            res.on('data', (c: Buffer | string) => {
                sz += typeof c === 'string' ? Buffer.byteLength(c) : c.length;
                if (sz > MAX_BODY) { req.destroy(); reject(new Error('Too large')); return; }
                data += c;
            });
            res.on('end', () => {
                if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                try { resolve(JSON.parse(data)); } catch { reject(new Error('JSON parse fail')); }
            });
        });
        req.on('error', (e) => reject(e));
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(postData);
        req.end();
    });
}

async function probeAndConnect(csrfToken: string, ports: number[]): Promise<LSInfo | null> {
    for (const port of ports) {
        for (const useTls of [true, false]) {
            const ls: LSInfo = { pid: 0, csrfToken, port, useTls };
            try {
                await rpcCall(ls, 'GetUnleashData', {
                    metadata: { ideName: 'antigravity', extensionName: 'antigravity', ideVersion: 'unknown', locale: 'en' }
                }, 3000);
                return ls;
            } catch { /* next */ }
        }
    }
    return null;
}

// ─── 分析 ────────────────────────────────────────────────────────────────────

function classifyType(type: string): string {
    const t = type.replace('CORTEX_STEP_TYPE_', '');
    const m: Record<string, string> = {
        'PLANNER_RESPONSE': '🧠 reasoning', 'VIEW_FILE': '📄 view_file',
        'CODE_ACTION': '✏️ code_action', 'RUN_COMMAND': '⚡ run_command',
        'COMMAND_STATUS': '📟 cmd_status', 'LIST_DIRECTORY': '📂 list_dir',
        'FIND': '🔍 find', 'GREP_SEARCH': '🔎 grep',
        'CODEBASE_SEARCH': '🗂️ code_search', 'MCP_TOOL': '🔌 mcp_tool',
        'SEARCH_WEB': '🌐 search_web', 'READ_URL_CONTENT': '🌐 read_url',
        'BROWSER_SUBAGENT': '🤖 browser', 'ERROR_MESSAGE': '❌ error',
        'USER_INPUT': '💬 user', 'CHECKPOINT': '💾 checkpoint',
        'CONVERSATION_HISTORY': '📜 history', 'KNOWLEDGE_ARTIFACTS': '📚 knowledge',
        'EPHEMERAL_MESSAGE': '💨 ephemeral', 'TASK_BOUNDARY': '📌 task',
        'NOTIFY_USER': '📢 notify', 'SEND_COMMAND_INPUT': '⌨️ send_input',
    };
    return m[t] || `❓ ${t}`;
}

function analyzeSteps(steps: Record<string, unknown>[], stepCount: number) {
    const genModelCounts = new Map<string, number>();
    const cpModelCounts = new Map<string, number>();
    const typeCounts = new Map<string, number>();
    let totalIn = 0, totalOut = 0, totalToolOut = 0;

    // 收集每步详细信息
    interface Row {
        i: number; type: string; gen: string; cpModel: string;
        detail: string; time: string; inTok: number; outTok: number; toolOutTok: number;
    }
    const rows: Row[] = [];

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const type = (step.type as string) || '';
        const meta = (step.metadata || {}) as Record<string, unknown>;
        const gen = (meta.generatorModel as string) || '';
        const createdAt = (meta.createdAt as string) || '';
        const toolOutTok = parseInt((meta.toolCallOutputTokens as string) || '0', 10);

        let cpModel = '', inTok = 0, outTok = 0;
        if (type === 'CORTEX_STEP_TYPE_CHECKPOINT') {
            const mu = meta.modelUsage as Record<string, string> | undefined;
            if (mu?.model) {
                cpModel = mu.model;
                inTok = parseInt(mu.inputTokens || '0', 10);
                outTok = parseInt(mu.outputTokens || '0', 10);
                totalIn += inTok; totalOut += outTok;
                cpModelCounts.set(cpModel, (cpModelCounts.get(cpModel) || 0) + 1);
            }
        }
        totalToolOut += toolOutTok;

        if (gen) genModelCounts.set(gen, (genModelCounts.get(gen) || 0) + 1);
        const st = type.replace('CORTEX_STEP_TYPE_', '');
        typeCounts.set(st, (typeCounts.get(st) || 0) + 1);

        // 提取细节
        let detail = '';
        try {
            const tc = meta.toolCall as Record<string, unknown> | undefined;
            if (tc?.argumentsJson) {
                const a = JSON.parse(tc.argumentsJson as string);
                if (a.AbsolutePath) detail = path.basename(a.AbsolutePath);
                else if (a.CommandLine) detail = (a.CommandLine as string).substring(0, 40);
                else if (a.Query) detail = `"${a.Query}"`;
                else if (tc.name) detail = String(tc.name).replace(/^mcp_[^_]+_/, '');
            }
            if (!detail && type.includes('USER_INPUT')) {
                const ui = step.userInput as Record<string, unknown> | undefined;
                const items = (ui?.items as Record<string, string>[]) || [];
                if (items[0]?.text) detail = items[0].text.substring(0, 60).replace(/[\r\n]+/g, ' ');
            }
            if (!detail && type.includes('PLANNER_RESPONSE')) {
                const pr = step.plannerResponse as Record<string, unknown> | undefined;
                const r = (pr?.modifiedResponse || pr?.response || '') as string;
                if (r) detail = r.substring(0, 60).replace(/[\r\n]+/g, ' ');
                else if (meta.thinkingDuration) detail = `thinking ${meta.thinkingDuration}`;
            }
        } catch { /* ignore */ }

        const time = createdAt ? new Date(createdAt).toLocaleTimeString('zh-CN', { hour12: false }) : '';
        rows.push({ i, type: classifyType(type), gen, cpModel, detail, time, inTok, outTok, toolOutTok });
    }

    // ── 报告 ──

    log('\n' + '═'.repeat(100));
    log(`📊 API 返回 ${steps.length} 步 (stepCount=${stepCount})`);
    if (steps.length < stepCount) {
        log(`⚠️ 窗口限制：${stepCount - steps.length} 步不可见 (${((steps.length / stepCount) * 100).toFixed(1)}%  覆盖)`);
    }
    log('═'.repeat(100));

    // 步骤类型
    log('\n【步骤类型分布】');
    for (const [t, c] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
        log(`  ${t.padEnd(25)} ${String(c).padStart(4)}  ${'█'.repeat(Math.min(c, 50))}`);
    }

    // generatorModel
    log('\n【generatorModel 分布】（步骤级 metadata.generatorModel）');
    for (const [m, c] of [...genModelCounts.entries()].sort((a, b) => b[1] - a[1])) {
        log(`  ${m.padEnd(55)} ${String(c).padStart(4)} (${((c / steps.length) * 100).toFixed(1)}%)`);
    }
    const noModel = steps.length - [...genModelCounts.values()].reduce((a, b) => a + b, 0);
    if (noModel > 0) log(`  ${'(无 generatorModel)'.padEnd(55)} ${String(noModel).padStart(4)}`);

    // CHECKPOINT modelUsage
    log('\n【CHECKPOINT.modelUsage 分布】（计费模型归属）');
    for (const [m, c] of [...cpModelCounts.entries()].sort((a, b) => b[1] - a[1])) {
        log(`  ${m.padEnd(55)} ${String(c).padStart(3)}`);
    }
    if (cpModelCounts.size === 0) log('  (无 CHECKPOINT modelUsage)');

    // 不一致分析
    log('\n【⚠️ 模型不一致分析】');
    const genSet = new Set(genModelCounts.keys());
    const cpSet = new Set(cpModelCounts.keys());
    const onlyCp = [...cpSet].filter(m => !genSet.has(m));
    const onlyGen = [...genSet].filter(m => !cpSet.has(m));
    if (onlyCp.length > 0) {
        log('  🔴 仅在 CHECKPOINT.modelUsage 中出现（幽灵模型）：');
        for (const m of onlyCp) log(`     → ${m} (${cpModelCounts.get(m)} 个 checkpoint)`);
    }
    if (onlyGen.length > 0) {
        log('  🟡 仅在 generatorModel 中出现（无 checkpoint）：');
        for (const m of onlyGen) log(`     → ${m} (${genModelCounts.get(m)} 步)`);
    }
    if (onlyCp.length === 0 && onlyGen.length === 0) log('  ✅ 完全一致');

    // Token 汇总
    log(`\n【Token 汇总】 inputTokens=${totalIn.toLocaleString()} outputTokens=${totalOut.toLocaleString()} toolOutput=${totalToolOut.toLocaleString()}`);

    // FLASH_LITE 专项
    log('\n【🔍 FLASH_LITE 专项】');
    let found = false;
    for (const r of rows) {
        if (r.gen.includes('FLASH_LITE') || r.cpModel.includes('FLASH_LITE')) {
            found = true;
            log(`  Step[${r.i}] ${r.time} ${r.type}`);
            if (r.gen.includes('FLASH_LITE')) log(`    generatorModel = ${r.gen}`);
            if (r.cpModel.includes('FLASH_LITE')) log(`    checkpoint.modelUsage = ${r.cpModel} (in=${r.inTok} out=${r.outTok})`);
        }
    }
    if (!found) log('  ❌ 无 FLASH_LITE 关联步骤');

    // 完整时间线
    log(`\n【完整时间线】（${rows.length} 步）`);
    for (const r of rows) {
        const model = r.cpModel || r.gen || '';
        const ms = model.replace('MODEL_PLACEHOLDER_', 'M').replace('MODEL_GOOGLE_GEMINI_', 'G/').replace('MODEL_OPENAI_', 'O/');
        const tok = r.inTok > 0 ? ` in=${r.inTok} out=${r.outTok}` : '';
        const d = r.detail ? ` | ${r.detail}` : '';
        log(`  [${String(r.i).padStart(4)}] ${r.time.padEnd(8)} ${r.type.padEnd(20)} ${ms.padEnd(30)}${tok}${d}`);
    }
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
    log('🚀 对话数据诊断脚本 v2.0');
    log('─'.repeat(60));

    const args = process.argv.slice(2);
    let cascadeFilter = '', titleFilter = '';
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--cascade' && args[i + 1]) { cascadeFilter = args[i + 1]; i++; }
        if (args[i] === '--title' && args[i + 1]) { titleFilter = args[i + 1]; i++; }
    }

    // 1. 发现 LS
    const info = discoverLS();
    if (!info) { log('❌ 无法发现 LS'); process.exit(1); }
    log(`🔍 LS PID=${info.pid}, 端口候选: [${info.ports.join(', ')}]`);

    // 2. 探测正确端口
    log('🔗 探测 RPC 端点...');
    const ls = await probeAndConnect(info.csrfToken, info.ports);
    if (!ls) { log('❌ 所有端口探测失败'); process.exit(1); }
    ls.pid = info.pid;
    log(`✅ 连接成功: 127.0.0.1:${ls.port} (${ls.useTls ? 'HTTPS' : 'HTTP'})`);

    // 3. 获取对话列表
    let traj: Record<string, unknown>;
    try { traj = await rpcCall(ls, 'GetAllCascadeTrajectories', {
        metadata: { ideName: 'antigravity', extensionName: 'antigravity' },
    }); }
    catch (e) { log(`❌ GetAllCascadeTrajectories 失败: ${e}`); process.exit(1); }

    // 响应结构: { trajectorySummaries: { [cascadeId]: { summary, stepCount, status, ... } } }
    const summaries = traj.trajectorySummaries as Record<string, Record<string, unknown>> | undefined;
    const all: Record<string, unknown>[] = [];
    if (summaries) {
        for (const [cascadeId, data] of Object.entries(summaries)) {
            all.push({
                cascadeId,
                summary: (data.summary as string) || cascadeId,
                stepCount: (data.stepCount as number) || 0,
                status: (data.status as string) || '',
                lastModifiedTime: (data.lastModifiedTime as string) || '',
            });
        }
        // 按最近修改排序
        all.sort((a, b) => {
            const ta = (a.lastModifiedTime as string) || '';
            const tb = (b.lastModifiedTime as string) || '';
            return tb.localeCompare(ta);
        });
    }
    log(`📋 ${all.length} 个对话`);

    // 列出所有对话
    log('\n【所有对话】');
    for (let i = 0; i < all.length; i++) {
        const t = all[i];
        const id = (t.cascadeId as string) || '';
        const sc = (t.stepCount as number) || 0;
        const st = ((t.status as string) || '').replace('CASCADE_RUN_STATUS_', '');
        const sm = ((t.summary as string) || '').substring(0, 65);
        const mark = (cascadeFilter && id.startsWith(cascadeFilter)) || (titleFilter && sm.includes(titleFilter)) ? ' ← 🎯' : '';
        log(`  [${String(i).padStart(2)}] ${id.substring(0, 8)}... ${st.padEnd(8)} steps=${String(sc).padStart(5)} | ${sm}${mark}`);
    }

    // 4. 定位目标
    let target: Record<string, unknown> | null = null;
    if (cascadeFilter) target = all.find(t => ((t.cascadeId as string) || '').startsWith(cascadeFilter)) || null;
    else if (titleFilter) target = all.find(t => ((t.summary as string) || '').includes(titleFilter)) || null;

    if (!target) {
        log(`\n💡 未匹配到目标。使用 --title "关键词" 或 --cascade <id前缀>`);
        saveReport('conversation_list');
        process.exit(0);
    }

    const cascadeId = target.cascadeId as string;
    const stepCount = (target.stepCount as number) || 0;
    const summary = (target.summary as string) || '';
    log(`\n🎯 目标: ${cascadeId}`);
    log(`   标题: ${summary}`);
    log(`   步骤数: ${stepCount}`);

    // 5. 获取步骤
    log(`\n⏳ 获取步骤数据...`);
    let stepsResult: Record<string, unknown>;
    try {
        stepsResult = await rpcCall(ls, 'GetCascadeTrajectorySteps', { cascadeId, startIndex: 0, endIndex: stepCount }, 30000);
    } catch (e) { log(`❌ GetCascadeTrajectorySteps 失败: ${e}`); process.exit(1); }

    const steps = (stepsResult.steps || []) as Record<string, unknown>[];
    const sz = JSON.stringify(stepsResult).length;
    log(`✅ 返回 ${steps.length} 步 | ${(sz / 1024).toFixed(0)} KB`);

    // 6. 分析
    analyzeSteps(steps, stepCount);

    // 7. 模型配置
    log('\n【当前 LS 模型配置】');
    try {
        const us = await rpcCall(ls, 'GetUserStatus', {
            metadata: { ideName: 'antigravity', extensionName: 'antigravity', ideVersion: '1.0', locale: 'en' },
        });
        const configs = (us.clientModelConfigs || []) as Record<string, unknown>[];
        for (const c of configs) {
            const model = (c.model as string) || '';
            const label = (c.label as string) || '';
            const qi = c.quotaInfo as Record<string, unknown> | undefined;
            const frac = qi?.remainingFraction as number | undefined;
            const pct = frac !== undefined ? (frac * 100).toFixed(1) + '%' : 'N/A';
            const fl = model.includes('FLASH_LITE') ? ' ← 🔴' : '';
            log(`  ${label.padEnd(35)} ${model.padEnd(50)} ${pct.padStart(6)}${fl}`);
        }
    } catch (e) { log(`  ❌ ${e}`); }

    // 保存
    const name = summary.substring(0, 40) || cascadeId.substring(0, 8);
    saveReport(name);
    saveJson(name, { cascadeId, stepCount, stepsReturned: steps.length, steps });

    log('\n✅ 诊断完成');
}

main().catch(err => { console.error('💥', err); process.exit(1); });
