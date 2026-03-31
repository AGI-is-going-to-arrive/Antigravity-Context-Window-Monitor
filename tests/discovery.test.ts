import { describe, it, expect } from 'vitest';
import { 
    buildExpectedWorkspaceId, 
    extractPid, 
    extractCsrfToken, 
    extractWorkspaceId, 
    filterLsProcessLines,
    extractPort,
    extractPortFromNetstat,
    extractPortFromSs,
    isWSL,
    selectMatchingProcessLine,
} from '../src/discovery';

describe('discovery.ts', () => {
    describe('buildExpectedWorkspaceId', () => {
        it('should handle standard Posix workspace URIs', () => {
            const uri = 'file:///Users/foo/bar';
            expect(buildExpectedWorkspaceId(uri)).toBe('file_Users_foo_bar');
        });

        it('should replace hyphens with underscores on all platforms', () => {
            const uri = 'file:///Users/foo/my-project';
            expect(buildExpectedWorkspaceId(uri)).toBe('file_Users_foo_my_project');
        });

        it('should handle percent-encoded spaces (%20) → _20', () => {
            // The LS keeps raw %20, replacing % → _, producing _20
            const uri = 'file:///Users/yangjunjie/Desktop/linux%20do/final/test';
            expect(buildExpectedWorkspaceId(uri)).toBe(
                'file_Users_yangjunjie_Desktop_linux_20do_final_test'
            );
        });

        it('should handle multiple percent-encoded characters', () => {
            const uri = 'file:///Users/foo/my%20project%20v2';
            expect(buildExpectedWorkspaceId(uri)).toBe('file_Users_foo_my_20project_20v2');
        });

        it('should handle parentheses, @, # and other special chars', () => {
            // Catch-all regex replaces ALL non-alphanumeric chars
            const uri = 'file:///Users/foo/project(v2)';
            expect(buildExpectedWorkspaceId(uri)).toBe('file_Users_foo_project_v2_');
        });

        it('should handle percent-encoded CJK characters (Chinese folder names)', () => {
            // 简历投递 encoded as %E7%AE%80%E5%8E%86%E6%8A%95%E9%80%92
            // The /% boundary produces adjacent _'s which must be collapsed
            const uri = 'file:///Users/yangjunjie/Desktop/%E7%AE%80%E5%8E%86%E6%8A%95%E9%80%92';
            expect(buildExpectedWorkspaceId(uri)).toBe(
                'file_Users_yangjunjie_Desktop_E7_AE_80_E5_8E_86_E6_8A_95_E9_80_92'
            );
        });

        it('should handle mixed space and CJK percent-encoded paths', () => {
            // /linux do/简历 → /linux%20do/%E7%AE%80%E5%8E%86
            const uri = 'file:///Users/yangjunjie/Desktop/linux%20do/%E7%AE%80%E5%8E%86';
            expect(buildExpectedWorkspaceId(uri)).toBe(
                'file_Users_yangjunjie_Desktop_linux_20do_E7_AE_80_E5_8E_86'
            );
        });

        it('should handle Japanese percent-encoded characters', () => {
            // テスト encoded as %E3%83%86%E3%82%B9%E3%83%88
            const uri = 'file:///Users/foo/%E3%83%86%E3%82%B9%E3%83%88';
            expect(buildExpectedWorkspaceId(uri)).toBe(
                'file_Users_foo_E3_83_86_E3_82_B9_E3_83_88'
            );
        });

        it('should handle vscode-remote URIs without decoding authority', () => {
            const uri = 'vscode-remote://wsl%2BUbuntu/home/user/project';
            expect(buildExpectedWorkspaceId(uri)).toBe('file_home_user_project');
        });

        if (process.platform === 'win32') {
            it('should handle Windows workspace URIs with colon encoding', () => {
                const uri = 'file:///c:/Users/8bit/project';
                // Step 1: file_c:/Users/8bit/project
                // Step 2: file_c_3A_/Users/8bit/project
                // Step 3: file_c_3A__Users_8bit_project
                // Step 4 (regex /__+/): file_c_3A_Users_8bit_project
                const result = buildExpectedWorkspaceId(uri);
                expect(result).toBe('file_c_3A_Users_8bit_project');
            });

            it('should handle hyphens on Windows', () => {
                const uri = 'file:///c:/my-project';
                const result = buildExpectedWorkspaceId(uri);
                expect(result).toBe('file_c_3A_my_project');
            });

            it('should handle percent-encoded Windows drive letters without decoding', () => {
                // %3A stays raw: % → _ produces _3A, then : replacement also applies
                const uri = 'file:///c%3A/Users/foo/my-project';
                const result = buildExpectedWorkspaceId(uri);
                // %3A → _3A (percent replaced), then : encoding also runs
                expect(result).toBe('file_c_3A_Users_foo_my_project');
            });
        }
    });

    describe('extractPid', () => {
        it('should extract PID from a ps-style line', () => {
            const line = '  12345 language_server_macos --csrf_token abc';
            expect(extractPid(line)).toBe(12345);
        });

        it('should return null for invalid lines', () => {
            expect(extractPid('invalid line')).toBe(null);
        });
    });

    describe('extractCsrfToken', () => {
        it('should extract CSRF token from command line', () => {
            const line = 'ls --csrf_token token123 --workspace_id ws1';
            expect(extractCsrfToken(line)).toBe('token123');
        });
    });

    describe('extractWorkspaceId', () => {
        it('should extract workspace ID from command line', () => {
            const line = 'ls --csrf_token t1 --workspace_id file_c_3A_tmp';
            expect(extractWorkspaceId(line)).toBe('file_c_3A_tmp');
        });
    });

    describe('filterLsProcessLines', () => {
        it('should filter correct process lines based on platform', () => {
            const binary = process.platform === 'win32' ? 'language_server_windows' : 'language_server_macos';
            const lines = [
                `100 ${binary} --antigravity --csrf_token x`,
                `101 some_other_proc`,
                `102 ${binary} --other --antigravity`
            ].join('\n');
            const filtered = filterLsProcessLines(lines);
            expect(filtered).toHaveLength(2);
            expect(filtered[0]).toContain('100');
        });
    });

    describe('selectMatchingProcessLine', () => {
        function workspaceUriForCurrentPlatform(name: string): string {
            return process.platform === 'win32'
                ? `file:///c:/Users/foo/${name}`
                : `file:///Users/foo/${name}`;
        }

        function makeLine(workspaceId?: string): string {
            const suffix = workspaceId ? ` --workspace_id ${workspaceId}` : '';
            return `language_server_windows --csrf_token token${suffix}`;
        }

        // ─── Basic behavior ─────────────────────────────────────────────
        it('falls back to the first line when workspaceUri is missing', () => {
            const lines = [makeLine('ws_a'), makeLine('ws_b')];
            expect(selectMatchingProcessLine(lines)).toBe(lines[0]);
        });

        it('returns the exact workspace match when one exists', () => {
            const workspaceUri = workspaceUriForCurrentPlatform('project-b');
            const expected = buildExpectedWorkspaceId(workspaceUri);
            const lines = [makeLine('other_workspace'), makeLine(expected)];
            expect(selectMatchingProcessLine(lines, workspaceUri)).toBe(lines[1]);
        });

        it('returns null for empty input', () => {
            expect(selectMatchingProcessLine([], workspaceUriForCurrentPlatform('project-e'))).toBe(null);
        });

        it('returns null for empty input without workspaceUri', () => {
            expect(selectMatchingProcessLine([])).toBe(null);
        });

        it('still finds the exact match among mixed lines', () => {
            const workspaceUri = workspaceUriForCurrentPlatform('project-f');
            const expected = buildExpectedWorkspaceId(workspaceUri);
            const lines = [makeLine(), makeLine('unrelated_workspace'), makeLine(expected)];
            expect(selectMatchingProcessLine(lines, workspaceUri)).toBe(lines[2]);
        });

        // ─── Fallback behavior (shared LS / multi-window) ──────────────
        it('falls back to first line when workspaceUri exists but no line matches', () => {
            const workspaceUri = workspaceUriForCurrentPlatform('project-c');
            const lines = [makeLine('different_workspace')];
            expect(selectMatchingProcessLine(lines, workspaceUri)).toBe(lines[0]);
        });

        it('falls back to first line when lines do not include a workspace_id flag', () => {
            const workspaceUri = workspaceUriForCurrentPlatform('project-d');
            const lines = [makeLine()];
            expect(selectMatchingProcessLine(lines, workspaceUri)).toBe(lines[0]);
        });

        it('falls back to first line among multiple non-matching LS processes', () => {
            const workspaceUri = workspaceUriForCurrentPlatform('my-project');
            const lines = [
                makeLine('workspace_a'),
                makeLine('workspace_b'),
                makeLine('workspace_c'),
            ];
            expect(selectMatchingProcessLine(lines, workspaceUri)).toBe(lines[0]);
        });

        it('falls back to first line when only one LS has no workspace_id and no match exists', () => {
            const workspaceUri = workspaceUriForCurrentPlatform('unrelated');
            const lines = [makeLine(), makeLine('some_other_ws')];
            // First line has no workspace_id so extractWorkspaceId returns null,
            // no match → fallback to lines[0]
            expect(selectMatchingProcessLine(lines, workspaceUri)).toBe(lines[0]);
        });

        // ─── Multi-window scenario simulation ──────────────────────────
        // Simulates: Window A opens workspace X, LS started with workspace X.
        // Window B opens workspace Y → no match → should fallback to shared LS.
        it('second window with different workspace falls back to shared LS', () => {
            // LS was started for workspace "data-analysis"
            const lsWorkspaceId = buildExpectedWorkspaceId(
                workspaceUriForCurrentPlatform('data-analysis')
            );
            const lines = [makeLine(lsWorkspaceId)];

            // Window B has workspace "my-extension" — doesn't match LS
            const windowBUri = workspaceUriForCurrentPlatform('my-extension');
            const result = selectMatchingProcessLine(lines, windowBUri);
            expect(result).toBe(lines[0]);
            // Should still be usable (has csrf_token)
            expect(result).toContain('--csrf_token');
        });

        // Simulates: Two LS processes for two workspaces, third window opens a
        // third workspace → should fallback to first LS.
        it('third window falls back to first of multiple LS processes', () => {
            const wsA = buildExpectedWorkspaceId(workspaceUriForCurrentPlatform('ws-a'));
            const wsB = buildExpectedWorkspaceId(workspaceUriForCurrentPlatform('ws-b'));
            const lines = [makeLine(wsA), makeLine(wsB)];

            const windowCUri = workspaceUriForCurrentPlatform('ws-c');
            expect(selectMatchingProcessLine(lines, windowCUri)).toBe(lines[0]);
        });

        // ─── Exact match still preferred ────────────────────────────────
        it('exact match is preferred over fallback even when first line differs', () => {
            const targetUri = workspaceUriForCurrentPlatform('target-project');
            const targetId = buildExpectedWorkspaceId(targetUri);
            const lines = [makeLine('wrong_ws'), makeLine('also_wrong'), makeLine(targetId)];
            // Should find exact match at index 2, not fallback to index 0
            expect(selectMatchingProcessLine(lines, targetUri)).toBe(lines[2]);
        });

        // ─── Edge cases ─────────────────────────────────────────────────
        it('handles workspaceUri with empty string (no folder opened)', () => {
            // Empty string is truthy, so it enters the matching branch
            const lines = [makeLine('some_ws')];
            // buildExpectedWorkspaceId('') produces '' after replacements
            // which won't match 'some_ws', so falls back to lines[0]
            expect(selectMatchingProcessLine(lines, '')).toBe(lines[0]);
        });

        it('handles undefined workspaceUri explicitly', () => {
            const lines = [makeLine('ws_a')];
            expect(selectMatchingProcessLine(lines, undefined)).toBe(lines[0]);
        });

        if (process.platform === 'win32') {
            // Windows-specific: workspace URIs with drive letters and CJK paths
            it('Windows: matches workspace with drive letter colon encoding', () => {
                const uri = 'file:///c:/Users/8bit/Desktop/project';
                const expectedId = buildExpectedWorkspaceId(uri);
                const lines = [makeLine('wrong'), makeLine(expectedId)];
                expect(selectMatchingProcessLine(lines, uri)).toBe(lines[1]);
            });

            it('Windows: falls back when CJK workspace URI does not match LS workspace', () => {
                // LS started for Chinese path "数据", Window opens for "antigravity"
                const lsUri = 'file:///c:/Users/8bit/Desktop/%E6%95%B0%E6%8D%AE';
                const lsId = buildExpectedWorkspaceId(lsUri);
                const lines = [makeLine(lsId)];

                const windowUri = 'file:///c:/Users/8bit/Desktop/antigravity';
                expect(selectMatchingProcessLine(lines, windowUri)).toBe(lines[0]);
            });

            it('Windows: exact match for CJK workspace URI', () => {
                const uri = 'file:///c:/Users/8bit/Desktop/%E6%95%B0%E6%8D%AE';
                const expectedId = buildExpectedWorkspaceId(uri);
                const lines = [makeLine('other'), makeLine(expectedId)];
                expect(selectMatchingProcessLine(lines, uri)).toBe(lines[1]);
            });
        }

        // ─── WSL / vscode-remote URIs ───────────────────────────────────
        it('handles vscode-remote workspace URI with fallback', () => {
            const wslUri = 'vscode-remote://wsl%2BUbuntu/home/user/project';
            const lines = [makeLine('completely_different_ws')];
            // No match → falls back to first LS
            expect(selectMatchingProcessLine(lines, wslUri)).toBe(lines[0]);
        });

        it('handles vscode-remote workspace URI with exact match', () => {
            const wslUri = 'vscode-remote://wsl%2BUbuntu/home/user/project';
            const expectedId = buildExpectedWorkspaceId(wslUri);
            const lines = [makeLine('other'), makeLine(expectedId)];
            expect(selectMatchingProcessLine(lines, wslUri)).toBe(lines[1]);
        });
    });

    describe('port extraction', () => {
        it('extractPort should handle lsof format', () => {
            const line = 'procnm 123 user 4u IPv4 0x... 0t0 TCP 127.0.0.1:54321 (LISTEN)';
            expect(extractPort(line)).toBe(54321);
        });

        it('extractPortFromNetstat should handle Windows netstat format', () => {
            const line = '  TCP    127.0.0.1:65432    0.0.0.0:0              LISTENING       1234';
            expect(extractPortFromNetstat(line)).toBe(65432);
        });

        it('extractPortFromSs should handle ss format with 127.0.0.1', () => {
            const line = 'LISTEN  0  128  127.0.0.1:54321  0.0.0.0:*  users:(("language_server_linux",pid=1234,fd=5))';
            expect(extractPortFromSs(line)).toBe(54321);
        });

        it('extractPortFromSs should handle ss format with wildcard', () => {
            const line = 'LISTEN  0  128  *:8080  *:*  users:(("node",pid=5678,fd=9))';
            expect(extractPortFromSs(line)).toBe(8080);
        });
    });

    describe('isWSL', () => {
        it('should return a boolean', () => {
            // On Windows test runner, isWSL() returns false (no /proc/version)
            // On actual WSL, it would return true
            expect(typeof isWSL()).toBe('boolean');
        });

        if (process.platform === 'win32') {
            it('should return false on native Windows', () => {
                expect(isWSL()).toBe(false);
            });
        }
    });
});

// ─── Backoff Constants & Behavior ────────────────────────────────────────────
// Tests verify that the discovery backoff caps at a lower interval than
// the RPC backoff, ensuring fast LS detection in multi-window scenarios.

describe('backoff constants', () => {
    // Import from constants to verify the actual values used at runtime
    let MAX_BACKOFF_INTERVAL_MS: number;
    let MAX_DISCOVERY_BACKOFF_MS: number;

    // Dynamic import so the test doesn't fail if the module has side effects
    it('loads constants', async () => {
        const mod = await import('../src/constants');
        MAX_BACKOFF_INTERVAL_MS = mod.MAX_BACKOFF_INTERVAL_MS;
        MAX_DISCOVERY_BACKOFF_MS = mod.MAX_DISCOVERY_BACKOFF_MS;
        expect(MAX_BACKOFF_INTERVAL_MS).toBeTypeOf('number');
        expect(MAX_DISCOVERY_BACKOFF_MS).toBeTypeOf('number');
    });

    it('discovery backoff cap is strictly lower than RPC backoff cap', async () => {
        const mod = await import('../src/constants');
        expect(mod.MAX_DISCOVERY_BACKOFF_MS).toBeLessThan(mod.MAX_BACKOFF_INTERVAL_MS);
    });

    it('discovery backoff cap is at most 15 seconds', async () => {
        const mod = await import('../src/constants');
        expect(mod.MAX_DISCOVERY_BACKOFF_MS).toBeLessThanOrEqual(15_000);
    });

    it('RPC backoff cap is 60 seconds', async () => {
        const mod = await import('../src/constants');
        expect(mod.MAX_BACKOFF_INTERVAL_MS).toBe(60_000);
    });

    // Simulate the backoff calculation used in handleLsFailure
    function computeBackoff(baseMs: number, failures: number, maxMs: number): number {
        return Math.min(baseMs * Math.pow(2, failures - 1), maxMs);
    }

    it('discovery backoff sequence caps at 15s (base=5s)', async () => {
        const mod = await import('../src/constants');
        const base = 5000;
        const max = mod.MAX_DISCOVERY_BACKOFF_MS;

        expect(computeBackoff(base, 1, max)).toBe(5000);   // 5s
        expect(computeBackoff(base, 2, max)).toBe(10000);  // 10s
        expect(computeBackoff(base, 3, max)).toBe(15000);  // 15s (capped)
        expect(computeBackoff(base, 4, max)).toBe(15000);  // still 15s
        expect(computeBackoff(base, 5, max)).toBe(15000);  // still 15s
        expect(computeBackoff(base, 10, max)).toBe(15000); // still 15s
    });

    it('RPC backoff sequence caps at 60s (base=5s)', async () => {
        const mod = await import('../src/constants');
        const base = 5000;
        const max = mod.MAX_BACKOFF_INTERVAL_MS;

        expect(computeBackoff(base, 1, max)).toBe(5000);   // 5s
        expect(computeBackoff(base, 2, max)).toBe(10000);  // 10s
        expect(computeBackoff(base, 3, max)).toBe(20000);  // 20s
        expect(computeBackoff(base, 4, max)).toBe(40000);  // 40s
        expect(computeBackoff(base, 5, max)).toBe(60000);  // 60s (capped)
        expect(computeBackoff(base, 6, max)).toBe(60000);  // still 60s
    });

    it('custom base interval still respects discovery cap', async () => {
        const mod = await import('../src/constants');
        const base = 10000; // user set 10s polling interval
        const max = mod.MAX_DISCOVERY_BACKOFF_MS;

        expect(computeBackoff(base, 1, max)).toBe(10000);  // 10s
        expect(computeBackoff(base, 2, max)).toBe(15000);  // 15s (capped, not 20s)
        expect(computeBackoff(base, 3, max)).toBe(15000);  // still 15s
    });

    it('base interval of 1s reaches discovery cap quickly', async () => {
        const mod = await import('../src/constants');
        const base = 1000;
        const max = mod.MAX_DISCOVERY_BACKOFF_MS;

        expect(computeBackoff(base, 1, max)).toBe(1000);   // 1s
        expect(computeBackoff(base, 2, max)).toBe(2000);   // 2s
        expect(computeBackoff(base, 3, max)).toBe(4000);   // 4s
        expect(computeBackoff(base, 4, max)).toBe(8000);   // 8s
        expect(computeBackoff(base, 5, max)).toBe(15000);  // 15s (capped, not 16s)
    });
});
