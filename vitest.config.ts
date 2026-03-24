import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        exclude: ['out/**', 'node_modules/**'],
    },
    resolve: {
        alias: {
            vscode: '__mocks__/vscode.ts',
        },
    },
});
