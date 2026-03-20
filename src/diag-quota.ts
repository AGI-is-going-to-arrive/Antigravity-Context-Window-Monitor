#!/usr/bin/env npx tsx
// ─── Quota Diagnostic Script ─────────────────────────────────────────────────
// 持续轮询 GetUserStatus，监控各模型的额度字段变化。
// 用途：验证 remainingFraction / resetTime 的完整行为模式。
//
// 运行：npx tsx src/diag-quota.ts
// 停止：Ctrl+C
//
// 观测目标：
//   1. 未使用模型的 resetTime 是否始终 = now + 5h？
//   2. 首次使用后 resetTime 是否立即锁定？
//   3. 耗尽时 remainingFraction 字段是否消失？
//   4. 恢复时 remainingFraction 和 resetTime 哪个先变化？
//   5. 是否存在非 5h 的重置周期（如 7 天）？

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as https from 'https';
import * as http from 'http';

const execFileAsync = promisify(execFile);

// ─── LS Discovery (简化版，仅 Windows) ──────────────────────────────────────

interface LSConn {
    port: number;
    csrfToken: string;
    useTls: boolean;
}

async function discoverLS(): Promise<LSConn | null> {
    // 1. wmic 查进程
    let output: string;
    try {
        const r = await execFileAsync('wmic', [
            'process', 'where', "name like 'language_server_windows%'",
            'get', 'ProcessId,CommandLine', '/format:csv'
        ], { encoding: 'utf-8', timeout: 5000 });
        output = r.stdout;
    } catch {
        // wmic 不可用→PowerShell 回退
        try {
            const r = await execFileAsync('powershell.exe', [
                '-NoProfile', '-NoLogo', '-Command',
                "Get-CimInstance Win32_Process -Filter \"Name like 'language_server_windows%'\" | Select-Object ProcessId, CommandLine | ConvertTo-Csv -NoTypeInformation"
            ], { encoding: 'utf-8', timeout: 10000 });
            output = r.stdout;
        } catch {
            return null;
        }
    }

    const lines = output.split('\n').filter(l =>
        l.includes('language_server_windows') && l.includes('antigravity')
    );
    if (lines.length === 0) { return null; }

    const line = lines[0];

    // CSRF token
    const csrfMatch = line.match(/--csrf_token\s+([^\s]+)/);
    if (!csrfMatch) { return null; }
    const csrfToken = csrfMatch[1];

    // PID
    const pidMatch = line.match(/(\d+)\s*$/);
    if (!pidMatch) { return null; }
    const pid = parseInt(pidMatch[1], 10);

    // 2. netstat 查端口
    let netstatOutput: string;
    try {
        const r = await execFileAsync('netstat', ['-ano'], { encoding: 'utf-8', timeout: 5000 });
        netstatOutput = r.stdout;
    } catch {
        return null;
    }

    const pidStr = String(pid);
    const ports: number[] = [];
    for (const nl of netstatOutput.split('\n')) {
        if (nl.includes('LISTENING') && nl.trim().endsWith(pidStr)) {
            const pm = nl.match(/\s+127\.0\.0\.1:(\d+)\s/);
            if (pm) { ports.push(parseInt(pm[1], 10)); }
        }
    }

    // 3. 逐端口探测
    for (const port of ports) {
        for (const useTls of [true, false]) {
            const ok = await probePort(port, csrfToken, useTls);
            if (ok) { return { port, csrfToken, useTls }; }
        }
    }
    return null;
}

function probePort(port: number, csrfToken: string, useTls: boolean): Promise<boolean> {
    return new Promise(resolve => {
        const postData = JSON.stringify({ metadata: { ideName: 'antigravity', extensionName: 'antigravity' } });
        const transport = useTls ? https : http;
        const req = transport.request({
            hostname: '127.0.0.1', port,
            path: '/exa.language_server_pb.LanguageServerService/GetUnleashData',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Connect-Protocol-Version': '1',
                'x-codeium-csrf-token': csrfToken,
                'Content-Length': Buffer.byteLength(postData),
            },
            timeout: 3000,
            rejectUnauthorized: false,
        }, res => {
            let body = '';
            res.on('data', (c: Buffer | string) => { body += c; });
            res.on('error', () => resolve(false));
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    try { JSON.parse(body); resolve(true); } catch { resolve(false); }
                } else { resolve(false); }
            });
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.write(postData);
        req.end();
    });
}

function rpcCall(ls: LSConn, endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
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
            timeout: 10000,
            rejectUnauthorized: false,
        }, res => {
            let data = '';
            res.on('data', (c: Buffer | string) => { data += c; });
            res.on('end', () => {
                if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.write(postData);
        req.end();
    });
}

// ─── 格式化工具 ─────────────────────────────────────────────────────────────

function fmtTime(isoStr: string): string {
    if (!isoStr) { return '—'; }
    const d = new Date(isoStr);
    return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function fmtDuration(ms: number): string {
    if (ms <= 0) { return '已过期'; }
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h}h${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s`;
}

function fmtPct(fraction: number | undefined): string {
    if (fraction === undefined || fraction === null) { return '⚠️ 缺失'; }
    return `${Math.round(fraction * 100)}%`;
}

// ─── 主逻辑 ─────────────────────────────────────────────────────────────────

interface PrevState {
    fraction: number | undefined;
    resetTime: string;
}

const prevStates = new Map<string, PrevState>();
let pollCount = 0;

async function poll(ls: LSConn): Promise<void> {
    pollCount++;
    const now = new Date();
    const nowStr = now.toLocaleTimeString('zh-CN', { hour12: false });

    const resp = await rpcCall(ls, 'GetUserStatus', {
        metadata: { ideName: 'antigravity', extensionName: 'antigravity' }
    });

    const userStatus = resp.userStatus as Record<string, unknown> | undefined;
    if (!userStatus) {
        console.log(`[${nowStr}] ⚠️ 无 userStatus`);
        return;
    }

    const configData = userStatus.cascadeModelConfigData as Record<string, unknown> | undefined;
    const rawConfigs = configData?.clientModelConfigs as Array<Record<string, unknown>> | undefined;
    if (!rawConfigs || rawConfigs.length === 0) {
        console.log(`[${nowStr}] ⚠️ 无模型配置`);
        return;
    }

    // 表头（每 20 轮打印一次）
    if (pollCount % 20 === 1) {
        console.log('\n' + '─'.repeat(120));
        console.log(
            '时间'.padEnd(10) +
            '模型'.padEnd(28) +
            'fraction'.padEnd(12) +
            'resetTime'.padEnd(12) +
            '距重置'.padEnd(16) +
            '变化'.padEnd(20)
        );
        console.log('─'.repeat(120));
    }

    for (const c of rawConfigs) {
        const label = (c.label as string) || '?';
        const modelAlias = c.modelOrAlias as Record<string, unknown> | undefined;
        const modelId = (modelAlias?.model as string) || '?';
        const qi = c.quotaInfo as Record<string, unknown> | undefined;

        // 关键字段——原始值，不做兜底
        const rawFraction: number | undefined = qi?.remainingFraction as number | undefined;
        const resetTime: string = (qi?.resetTime as string) || '';

        // 距重置时间
        const resetDate = resetTime ? new Date(resetTime) : null;
        const deltaMs = resetDate ? resetDate.getTime() - now.getTime() : 0;

        // 变化检测
        const prev = prevStates.get(modelId);
        let changeNote = '';
        if (prev) {
            const fractionChanged = prev.fraction !== rawFraction;
            const resetChanged = prev.resetTime !== resetTime;
            if (fractionChanged) {
                changeNote += `额度 ${fmtPct(prev.fraction)} → ${fmtPct(rawFraction)}  `;
            }
            if (resetChanged) {
                changeNote += `重置时间变化`;
            }
        }

        prevStates.set(modelId, { fraction: rawFraction, resetTime });

        // 标记是否接近 5h（4:55~5:05 范围内）
        const nearFiveHours = deltaMs > 0 && Math.abs(deltaMs - 5 * 3600 * 1000) < 5 * 60 * 1000;
        const tag = nearFiveHours ? ' [≈5h]' : '';

        const line =
            nowStr.padEnd(10) +
            label.padEnd(28) +
            fmtPct(rawFraction).padEnd(12) +
            fmtTime(resetTime).padEnd(12) +
            (fmtDuration(deltaMs) + tag).padEnd(16) +
            (changeNote || '—');

        // 有变化时高亮
        if (changeNote) {
            console.log(`\x1b[33m${line}\x1b[0m`);
        } else {
            console.log(line);
        }
    }
    console.log('');
}

// ─── 入口 ───────────────────────────────────────────────────────────────────

const POLL_INTERVAL = 5000; // 5 秒

async function main(): Promise<void> {
    console.log('🔍 发现 Language Server...');
    const ls = await discoverLS();
    if (!ls) {
        console.error('❌ 未找到 LS 进程。请确保 Antigravity IDE 已启动。');
        process.exit(1);
    }
    console.log(`✅ 已连接 LS (port=${ls.port}, tls=${ls.useTls})`);
    console.log(`📊 开始轮询（${POLL_INTERVAL / 1000}s 间隔），Ctrl+C 停止\n`);
    console.log('观测目标：');
    console.log('  1. 未使用模型 resetTime 距现在是否 ≈ 5h？（标记 [≈5h]）');
    console.log('  2. 首次使用后 fraction / resetTime 变化时序');
    console.log('  3. 耗尽时 fraction 字段是否消失（显示 ⚠️ 缺失）');
    console.log('  4. 恢复时哪个字段先变\n');

    // 首次立即执行
    try {
        await poll(ls);
    } catch (e) {
        console.error('首次轮询失败:', e);
    }

    // 持续轮询
    const timer = setInterval(async () => {
        try {
            await poll(ls);
        } catch (e) {
            console.error('轮询出错:', e);
        }
    }, POLL_INTERVAL);

    // 优雅退出
    process.on('SIGINT', () => {
        clearInterval(timer);
        console.log('\n🛑 已停止（共轮询 ' + pollCount + ' 次）');

        // 打印汇总
        console.log('\n━━━ 最终状态汇总 ━━━');
        for (const [modelId, state] of prevStates) {
            console.log(`  ${modelId}: fraction=${fmtPct(state.fraction)}, resetTime=${fmtTime(state.resetTime)}`);
        }
        process.exit(0);
    });
}

main().catch(console.error);
