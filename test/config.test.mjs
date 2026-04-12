import { test } from 'node:test';
import assert from 'node:assert/strict';
import traverse from '../lib/traverse-async.js';

const peakConcurrency = (parallel, delay = 30) =>
  new Promise((resolve, reject) => {
    let active = 0;
    let peak = 0;
    traverse(
      { a: 1, b: 2, c: 3 },
      ({ isRoot }) => {
        if (isRoot) return;
        active++;
        peak = Math.max(peak, active);
        return new Promise((r) => setTimeout(() => { active--; r(); }, delay));
      },
      { parallel }
    ).then(() => resolve(peak)).catch(reject);
  });

// --- default behaviour ---

test('default parallel is 1 (serial)', async () => {
  const peak = await peakConcurrency(1);
  assert.equal(peak, 1);
});

// --- parallel option ---

test('parallel: 2 allows two nodes to run concurrently', async () => {
  const peak = await peakConcurrency(2);
  assert.ok(peak >= 2, `expected peak >= 2, got ${peak}`);
});

test('parallel: 3 allows three nodes to run concurrently', async () => {
  const peak = await peakConcurrency(3);
  assert.ok(peak >= 3, `expected peak >= 3, got ${peak}`);
});

test('each traverse call uses its own parallel setting', async () => {
  const [peak1, peak2] = await Promise.all([
    peakConcurrency(1),
    peakConcurrency(3),
  ]);
  assert.equal(peak1, 1);
  assert.ok(peak2 >= 2, `expected peak >= 2, got ${peak2}`);
});

test('parallel defaults to 1 when option is omitted', async () => {
  let active = 0;
  let maxActive = 0;
  await traverse({ a: 1, b: 2, c: 3 }, ({ isRoot }) => {
    if (isRoot) return;
    active++;
    maxActive = Math.max(maxActive, active);
    return new Promise((r) => setTimeout(() => { active--; r(); }, 30));
  });
  assert.equal(maxActive, 1);
});
