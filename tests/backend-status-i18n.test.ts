import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { getLanguage, setLanguage, type Language } from '../src/i18n';
import { StatusBarManager } from '../src/statusbar';

const context = {
    globalState: { update: async () => {} },
} as unknown as vscode.ExtensionContext;
const originalLanguage = getLanguage();

afterEach(async () => {
    vi.restoreAllMocks();
    await setLanguage(originalLanguage, context);
});

describe('backend connection status localization', () => {
    it.each<Language>(['en', 'zh', 'both'])('localizes missing and lost backend in %s', async language => {
        await setLanguage(language, context);
        const create = vi.spyOn(vscode.window, 'createStatusBarItem');
        const manager = new StatusBarManager();
        const item = create.mock.results[0].value as vscode.StatusBarItem;
        manager.showDisconnected('LS not found');
        expect(item.text).toContain(language === 'en' ? 'Context: N/A' : '上下文：不可用');
        expect((item.tooltip as vscode.MarkdownString).value).toContain(language === 'zh' ? '未找到 Antigravity 后端' : 'Antigravity backend not found');
        expect((item.tooltip as vscode.MarkdownString).value).toContain('agy hub');
        manager.showDisconnected('LS connection lost');
        expect((item.tooltip as vscode.MarkdownString).value).toContain(language === 'zh' ? '重新连接' : 'Reconnecting');
        manager.dispose();
    });

    it('updates the disconnected label and tooltip immediately when language changes', async () => {
        await setLanguage('en', context);
        const create = vi.spyOn(vscode.window, 'createStatusBarItem');
        const manager = new StatusBarManager();
        const item = create.mock.results[0].value as vscode.StatusBarItem;
        manager.showDisconnected('LS not found');
        await setLanguage('zh', context);
        manager.refreshFromConfig();
        expect(item.text).toContain('上下文：不可用');
        expect((item.tooltip as vscode.MarkdownString).value).toContain('未找到 Antigravity 后端');
        expect(item.name).toBe('上下文窗口监控');
        manager.showInitializing();
        await setLanguage('en', context);
        manager.refreshFromConfig();
        expect(item.text).toContain('Context...');
        expect((item.tooltip as vscode.MarkdownString).value).toContain('Connecting to Antigravity');
        manager.dispose();
    });

    it('shows a recovery action for unexpected errors and clears stale state on recovery', () => {
        const create = vi.spyOn(vscode.window, 'createStatusBarItem');
        const manager = new StatusBarManager();
        const item = create.mock.results[0].value as vscode.StatusBarItem;
        manager.showDisconnected('RPC HTTP 503');
        expect((item.tooltip as vscode.MarkdownString).value).toMatch(/local backend|本地后端/);
        expect((item.tooltip as vscode.MarkdownString).value).not.toContain('RPC HTTP 503');
        manager.showNoConversation('256k', 'MODEL_PLACEHOLDER_M418');
        manager.refreshFromConfig();
        expect(item.text).not.toContain('debug-disconnect');
        expect(item.text).not.toMatch(/0k\//);
        expect(item.text).toContain('comment-discussion');
        manager.dispose();
    });
});
