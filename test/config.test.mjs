import { test } from 'node:test';
import assert from 'node:assert/strict';
import traverse, { config } from '../lib/traverse-async.js';

// Runs a traverse over { a, b, c } where each non-root node takes `delay` ms.
// Returns the peak number of nodes active at the same time.
const peakConcurrency = (delay = 30) =>
  new Promise((resolve) => {
    let active = 0;
    let peak = 0;
    traverse(
      { a: 1, b: 2, c: 3 },
      function (node, next) {
        if (this.isRoot) return next();
        active++;
        peak = Math.max(peak, active);
        setTimeout(() => { active--; next(); }, delay);
      },
      () => resolve(peak)
    );
  });

// --- default behaviour ---

test('default parallel is 1 (serial)', async () => {
  const peak = await peakConcurrency();
  assert.equal(peak, 1);
});

// --- setting parallel ---

test('parallel: 2 allows two nodes to run concurrently', async () => {
  config({ parallel: 2 });
  const peak = await peakConcurrency();
  config({ parallel: 1 });
  assert.ok(peak >= 2, `expected peak >= 2, got ${peak}`);
});

test('parallel: 3 allows three nodes to run concurrently', async () => {
  config({ parallel: 3 });
  const peak = await peakConcurrency();
  config({ parallel: 1 });
  assert.ok(peak >= 3, `expected peak >= 3, got ${peak}`);
});

// --- persistence ---

test('config persists across separate traverse calls', async () => {
  config({ parallel: 2 });
  const peak1 = await peakConcurrency();
  const peak2 = await peakConcurrency();
  config({ parallel: 1 });
  assert.ok(peak1 >= 2, `first call: expected peak >= 2, got ${peak1}`);
  assert.ok(peak2 >= 2, `second call: expected peak >= 2, got ${peak2}`);
});

test('resetting to parallel: 1 restores serial behaviour', async () => {
  config({ parallel: 3 });
  config({ parallel: 1 });
  const peak = await peakConcurrency();
  assert.equal(peak, 1);
});

// --- multiple keys ---

test('config merges multiple keys in one call', async () => {
  // parallel is the only meaningful key; extra keys should be stored without error
  assert.doesNotThrow(() => config({ parallel: 2, unknownOption: true }));
  const peak = await peakConcurrency();
  config({ parallel: 1 });
  assert.ok(peak >= 2, `expected peak >= 2, got ${peak}`);
});

// --- repeated calls ---

test('successive config calls each take effect', async () => {
  config({ parallel: 1 });
  const peak1 = await peakConcurrency();
  assert.equal(peak1, 1);

  config({ parallel: 2 });
  const peak2 = await peakConcurrency();
  assert.ok(peak2 >= 2, `expected peak >= 2 after second config, got ${peak2}`);

  config({ parallel: 1 });
});

// --- unknown keys are tolerated ---

test('unknown config keys do not break traversal', async () => {
  config({ unknownKey: 'whatever' });
  const visited = [];
  await new Promise((resolve) => {
    traverse({ a: 1, b: 2 }, function (node, next) {
      visited.push(node);
      next();
    }, resolve);
  });
  assert.equal(visited.length, 3); // root + a + b
});
