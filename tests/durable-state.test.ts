import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { DurableState, StateBucket } from '../src/durable-state';

const tempDirs: string[] = [];

function makeFallbackState(seed: Record<string, unknown>): StateBucket {
    const state = { ...seed };
    return {
        get<T>(key: string, defaultValue: T): T {
            return (key in state ? state[key] : defaultValue) as T;
        },
        update(key: string, value: unknown): Promise<void> {
            state[key] = value;
            return Promise.resolve();
        },
    };
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('DurableState', () => {
    it('migrates fallback values into an external file and restores them later', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agcm-state-'));
        tempDirs.push(dir);
        const filePath = path.join(dir, 'state-v1.json');
        const fallback = makeFallbackState({
            activityTrackerState: { version: 1, value: 'from-fallback' },
        });

        const state = new DurableState(filePath);
        const bucket = state.globalBucket(fallback);
        const migrated = bucket.get<Record<string, unknown>>('activityTrackerState', {});
        expect(migrated.value).toBe('from-fallback');
        expect(fs.existsSync(filePath)).toBe(true);

        await bucket.update('activityTrackerState', { version: 1, value: 'from-file' });

        const restored = new DurableState(filePath).globalBucket(makeFallbackState({}));
        const restoredValue = restored.get<Record<string, unknown>>('activityTrackerState', {});
        expect(restoredValue.value).toBe('from-file');
    });
});
