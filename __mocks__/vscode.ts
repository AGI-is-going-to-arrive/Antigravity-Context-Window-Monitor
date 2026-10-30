// Mock vscode module for unit tests.
// Provides minimal stubs so that imports resolve without the real VS Code runtime.

export class ThemeColor {
    constructor(public id: string) {}
}

export const StatusBarAlignment = {
    Left: 1,
    Right: 2,
};

export const ViewColumn = {
    Active: -1,
    Beside: -2,
    One: 1,
    Two: 2,
};

export const QuickPickItemKind = {
    Separator: -1,
    Default: 0,
};

export class MarkdownString {
    value: string;
    supportThemeIcons: boolean = false;
    constructor(value?: string, _supportHtml?: boolean) {
        this.value = value || '';
    }
}

export const Uri = {
    file: (fsPath: string) => ({ scheme: 'file', fsPath }),
    parse: (value: string) => ({ scheme: 'file', fsPath: value }),
};

export const window = {
    createStatusBarItem: (_alignment?: number, _priority?: number) => ({
        text: '',
        tooltip: undefined as unknown,
        backgroundColor: undefined as unknown,
        command: '',
        name: '',
        show: () => {},
        hide: () => {},
        dispose: () => {},
    }),
    createOutputChannel: (_name: string) => ({
        appendLine: (_msg: string) => {},
        dispose: () => {},
    }),
    createWebviewPanel: () => ({
        webview: {
            html: '',
            postMessage: () => {},
            onDidReceiveMessage: () => ({ dispose: () => {} }),
        },
        reveal: () => {},
        onDidDispose: () => ({ dispose: () => {} }),
    }),
    showQuickPick: async (_items: unknown[], _options?: unknown) => undefined,
    showInformationMessage: async (_msg: string) => undefined,
    showWarningMessage: async (_msg: string, ..._items: unknown[]) => undefined,
    showTextDocument: async (_doc: unknown, _options?: unknown) => undefined,
};

export const workspace = {
    getConfiguration: (_section?: string) => ({
        get: <T>(_key: string, defaultValue?: T) => defaultValue,
    }),
    openTextDocument: async (_target: unknown) => ({ uri: _target }),
    fs: {
        stat: async (_target: unknown) => _target,
    },
    workspaceFolders: undefined,
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
};

export const commands = {
    registerCommand: (_command: string, _callback: (...args: unknown[]) => unknown) => ({
        dispose: () => {},
    }),
    executeCommand: async (_command: string, ..._args: unknown[]) => undefined,
};

export const env = {
    clipboard: {
        writeText: async (_text: string) => undefined,
    },
};

export const extensions = {
    getExtension: (_id: string): unknown => undefined,
};

export default {
    ThemeColor,
    StatusBarAlignment,
    ViewColumn,
    QuickPickItemKind,
    MarkdownString,
    Uri,
    window,
    workspace,
    commands,
    env,
    extensions,
};
