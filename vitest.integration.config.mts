import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const vscodeMockPath = fileURLToPath(new URL('./__mocks__/vscode.ts', import.meta.url));

export default defineConfig({
    test: {
        include: ['tests/integration/**/*.integration.test.ts'],
        exclude: [
            'out/**',
            'out-tsc/**',
            'dist/**',
            'dist-stage/**',
            'node_modules/**',
        ],
        testTimeout: 30_000,
        hookTimeout: 20_000,
    },
    resolve: {
        alias: {
            vscode: vscodeMockPath,
        },
    },
});
