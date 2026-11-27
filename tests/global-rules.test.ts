import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    DEFAULT_GLOBAL_RULES_TEMPLATE,
    GLOBAL_RULES_FILE_NAME,
    GLOBAL_RULES_MAX_BYTES,
    getGlobalRulesPath,
    readGlobalRulesStatus,
    writeGlobalRulesFile,
} from '../src/global-rules';
import { buildSettingsContent, DEFAULT_MONITOR_DOCUMENT_SETTINGS } from '../src/webview-settings-tab';
import { buildMonitorDocumentHtml } from '../src/webview-document';
import { esc } from '../src/webview-helpers';

let tempHome = '';

beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-global-rules-'));
});

afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
});

describe('getGlobalRulesPath', () => {
    it('joins ~/.gemini/GEMINI.md under the supplied homedir', () => {
        expect(getGlobalRulesPath(tempHome)).toBe(path.join(tempHome, '.gemini', GLOBAL_RULES_FILE_NAME));
    });

    it('falls back to os.homedir() without an argument', () => {
        expect(getGlobalRulesPath()).toBe(path.join(os.homedir(), '.gemini', GLOBAL_RULES_FILE_NAME));
    });
});

describe('readGlobalRulesStatus', () => {
    it('reports a missing file with empty content and no error', () => {
        const status = readGlobalRulesStatus({ homedir: tempHome });
        expect(status.exists).toBe(false);
        expect(status.sizeBytes).toBe(0);
        expect(status.content).toBe('');
        expect(status.tooLarge).toBe(false);
        expect(status.path).toBe(getGlobalRulesPath(tempHome));
    });

    it('round-trips content written by writeGlobalRulesFile', () => {
        writeGlobalRulesFile('# My rules\nAlways answer in Chinese.\n', tempHome);
        const status = readGlobalRulesStatus({ homedir: tempHome });
        expect(status.exists).toBe(true);
        expect(status.content).toBe('# My rules\nAlways answer in Chinese.\n');
        expect(status.sizeBytes).toBeGreaterThan(0);
        expect(status.tooLarge).toBe(false);
    });

    it('flags oversized files and returns no content', () => {
        const rulesPath = getGlobalRulesPath(tempHome);
        fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
        fs.writeFileSync(rulesPath, 'x'.repeat(GLOBAL_RULES_MAX_BYTES + 1), 'utf8');
        const status = readGlobalRulesStatus({ homedir: tempHome });
        expect(status.exists).toBe(true);
        expect(status.tooLarge).toBe(true);
        expect(status.content).toBe('');
    });

    it('can stat without content when includeContent is false', () => {
        writeGlobalRulesFile('hello rules', tempHome);
        const status = readGlobalRulesStatus({ homedir: tempHome, includeContent: false });
        expect(status.exists).toBe(true);
        expect(status.content).toBe('');
        expect(status.sizeBytes).toBe(Buffer.byteLength('hello rules', 'utf8'));
    });
});

describe('writeGlobalRulesFile', () => {
    it('creates the ~/.gemini parent directory when missing', () => {
        const rulesPath = getGlobalRulesPath(tempHome);
        expect(fs.existsSync(path.dirname(rulesPath))).toBe(false);
        const status = writeGlobalRulesFile(DEFAULT_GLOBAL_RULES_TEMPLATE, tempHome);
        expect(fs.existsSync(rulesPath)).toBe(true);
        expect(status.exists).toBe(true);
        expect(status.sizeBytes).toBe(Buffer.byteLength(DEFAULT_GLOBAL_RULES_TEMPLATE, 'utf8'));
    });

    it('overwrites existing content atomically with the new payload', () => {
        writeGlobalRulesFile('first', tempHome);
        writeGlobalRulesFile('second rules', tempHome);
        expect(readGlobalRulesStatus({ homedir: tempHome }).content).toBe('second rules');
    });

    it('rejects oversized content before touching the disk', () => {
        const rulesPath = getGlobalRulesPath(tempHome);
        fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
        fs.writeFileSync(rulesPath, 'keep-original', 'utf8');
        expect(() => writeGlobalRulesFile('y'.repeat(GLOBAL_RULES_MAX_BYTES + 1), tempHome)).toThrow(/too large/i);
        expect(fs.readFileSync(rulesPath, 'utf8')).toBe('keep-original');
    });
});

describe('Settings tab Global Rules card', () => {
    it('renders path, editor content, actions and size for an existing file', () => {
        const status = writeGlobalRulesFile('# Team rules\nBe concise.\n', tempHome);
        const html = buildSettingsContent([], undefined, undefined, {
            settings: DEFAULT_MONITOR_DOCUMENT_SETTINGS,
            globalRules: status,
        });
        expect(html).toContain('id="globalRulesCard"');
        expect(html).toContain('id="globalRulesEditor"');
        expect(html).toContain('id="globalRulesOpenBtn"');
        expect(html).toContain('id="globalRulesRevealBtn"');
        expect(html).toContain('id="globalRulesReloadBtn"');
        expect(html).toContain('id="globalRulesSaveBtn"');
        expect(html).toContain('id="globalRulesFeedback"');
        expect(html).toContain('id="globalRulesPathText"');
        expect(html).toContain(`id="globalRulesPathText">${esc(status.path)}</code>`);
        expect(html).toContain('# Team rules');
        expect(html).toContain('data-gr-exists="true"');
        expect(html).toContain('class="stg-globalrules-editor"');
    });

    it('renders a Missing pill and empty editor for a nonexistent file', () => {
        const html = buildSettingsContent([], undefined, undefined, {
            settings: DEFAULT_MONITOR_DOCUMENT_SETTINGS,
            globalRules: readGlobalRulesStatus({ homedir: tempHome }),
        });
        expect(html).toContain('data-gr-exists="false"');
        expect(html).toContain('globalRulesEditor');
    });

    it('escapes HTML inside rules content (XSS-safe textarea)', () => {
        const status = writeGlobalRulesFile('<script>alert("x")</script>', tempHome);
        const html = buildSettingsContent([], undefined, undefined, {
            settings: DEFAULT_MONITOR_DOCUMENT_SETTINGS,
            globalRules: status,
        });
        expect(html).not.toContain('<script>alert');
        expect(html).toContain('&lt;script&gt;');
    });

    it('marks too-large files and disables inline content', () => {
        const rulesPath = getGlobalRulesPath(tempHome);
        fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
        fs.writeFileSync(rulesPath, 'z'.repeat(GLOBAL_RULES_MAX_BYTES + 1), 'utf8');
        const html = buildSettingsContent([], undefined, undefined, {
            settings: DEFAULT_MONITOR_DOCUMENT_SETTINGS,
            globalRules: readGlobalRulesStatus({ homedir: tempHome }),
        });
        expect(html).toContain('data-gr-too-large="true"');
    });

    it('renders the card on the app-sidecar surface as well', () => {
        const status = writeGlobalRulesFile('sidecar rules', tempHome);
        const html = buildSettingsContent([], undefined, undefined, {
            settings: DEFAULT_MONITOR_DOCUMENT_SETTINGS,
            surface: 'app-sidecar',
            globalRules: status,
        });
        expect(html).toContain('id="globalRulesCard"');
        expect(html).toContain('sidecar rules');
    });

    it('hides the card when globalRules is explicitly null', () => {
        const html = buildSettingsContent([], undefined, undefined, {
            settings: DEFAULT_MONITOR_DOCUMENT_SETTINGS,
            globalRules: null,
        });
        expect(html).not.toContain('id="globalRulesCard"');
    });
});

describe('Monitor document wiring', () => {
    it('includes the Global Rules card in a full document render', () => {
        const status = writeGlobalRulesFile('# Doc render rules\n', tempHome);
        const html = buildMonitorDocumentHtml({
            surface: 'ide',
            version: '1.18.0',
            settings: DEFAULT_MONITOR_DOCUMENT_SETTINGS,
            globalRules: status,
            now: Date.parse('2026-11-27T10:30:00Z'),
        });
        expect(html).toContain('id="globalRulesCard"');
        expect(html).toContain('# Doc render rules');
    });
});
