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
            // Mirrors: id = workspaceUri.replace(':///', '_'); id = id.replace(/\//g, '_');
            const uri = 'file:///Users/foo/bar';
            const expected = 'file_Users_foo_bar';
            expect(buildExpectedWorkspaceId(uri)).toBe(expected);
        });

        it('should replace hyphens with underscores on all platforms', () => {
            // The LS converts hyphens to underscores in --workspace_id on ALL platforms
            const uri = 'file:///Users/foo/my-project';
            const expected = 'file_Users_foo_my_project';
            expect(buildExpectedWorkspaceId(uri)).toBe(expected);
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

            it('should decode percent-encoded Windows drive letters before building workspace id', () => {
                const uri = 'file:///c%3A/Users/foo/my-project';
                const result = buildExpectedWorkspaceId(uri);
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

        it('returns null when workspaceUri exists but no line matches', () => {
            const workspaceUri = workspaceUriForCurrentPlatform('project-c');
            const lines = [makeLine('different_workspace')];
            expect(selectMatchingProcessLine(lines, workspaceUri)).toBe(null);
        });

        it('returns null when lines do not include a workspace_id flag', () => {
            const workspaceUri = workspaceUriForCurrentPlatform('project-d');
            const lines = [makeLine()];
            expect(selectMatchingProcessLine(lines, workspaceUri)).toBe(null);
        });

        it('returns null for empty input', () => {
            expect(selectMatchingProcessLine([], workspaceUriForCurrentPlatform('project-e'))).toBe(null);
        });

        it('still finds the exact match among mixed lines', () => {
            const workspaceUri = workspaceUriForCurrentPlatform('project-f');
            const expected = buildExpectedWorkspaceId(workspaceUri);
            const lines = [makeLine(), makeLine('unrelated_workspace'), makeLine(expected)];
            expect(selectMatchingProcessLine(lines, workspaceUri)).toBe(lines[2]);
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
