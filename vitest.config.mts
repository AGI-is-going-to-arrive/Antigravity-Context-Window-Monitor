import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const vscodeMockPath = fileURLToPath(new URL('./__mocks__/vscode.ts', import.meta.url));

export default defineConfig({
    test: {
        include: ['tests/*.test.ts'],
        exclude: [
            'tests/integration/**',
            'tests/e2e/**',
            'out/**',
            'out-tsc/**',
            'dist/**',
            'dist-stage/**',
            'node_modules/**',
        ],
    },
    resolve: {
        alias: {
            vscode: vscodeMockPath,
        },
    },
});
