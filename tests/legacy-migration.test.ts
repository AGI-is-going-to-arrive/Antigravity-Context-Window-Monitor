import { describe, expect, it } from 'vitest';
import { runLegacyMigrationOnce, type LegacyMigrationData, type LegacyMigrationResult } from '../src/legacy-migration';

describe('legacy migration idempotency', () => {
    it('does not mark migration done when extraction fails transiently', () => {
        let markedDone = false;
        let imported = false;

        const result = runLegacyMigrationOnce({
            migrationDone: false,
            extractLegacyData: (): LegacyMigrationResult => ({ status: 'failed', error: 'database is locked' }),
            importLegacyData: () => { imported = true; },
            markDone: () => { markedDone = true; },
            log: () => {},
        });

        expect(result?.status).toBe('failed');
        expect(imported).toBe(false);
        expect(markedDone).toBe(false);
    });

    it('marks migration done for imported, empty, and not-found outcomes', () => {
        const outcomes: LegacyMigrationResult[] = [
            {
                status: 'imported',
                data: {
                    dailyStoreState: { version: 1, records: { '2026-06-01': { date: '2026-06-01', cycles: [] } } },
                    displayLanguage: 'zh',
                },
            },
            { status: 'empty' },
            { status: 'not_found' },
        ];

        for (const outcome of outcomes) {
            let markedDone = false;
            const imported: LegacyMigrationData[] = [];

            const result = runLegacyMigrationOnce({
                migrationDone: false,
                extractLegacyData: () => outcome,
                importLegacyData: (data) => { imported.push(data); },
                markDone: () => { markedDone = true; },
                log: () => {},
            });

            expect(result?.status).toBe(outcome.status);
            expect(markedDone).toBe(true);
            expect(imported).toHaveLength(outcome.status === 'imported' ? 1 : 0);
        }
    });

    it('skips extraction after migration has already completed', () => {
        let extractorCalls = 0;
        let markedDone = false;

        const result = runLegacyMigrationOnce({
            migrationDone: true,
            extractLegacyData: () => {
                extractorCalls++;
                return { status: 'not_found' };
            },
            importLegacyData: () => {},
            markDone: () => { markedDone = true; },
            log: () => {},
        });

        expect(result).toBeNull();
        expect(extractorCalls).toBe(0);
        expect(markedDone).toBe(false);
    });
});
