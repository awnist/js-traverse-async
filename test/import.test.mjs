import { test } from 'node:test';
import assert from 'node:assert/strict';

import traverse from '../lib/traverse-async.js';
import traverse2 from '../lib/traverse-async.js';
import * as ns from '../lib/traverse-async.js';

const ping = (fn) => fn({ a: 1 }, () => {});

// --- default import ---

test('default import is the traverse function', async () => {
  assert.equal(typeof traverse, 'function');
  await ping(traverse);
});

// --- combined default import ---

test('combined import: traverse is a function', async () => {
  assert.equal(typeof traverse2, 'function');
  await ping(traverse2);
});

// --- namespace import ---

test('namespace import default is the traverse function', async () => {
  assert.equal(typeof ns.default, 'function');
  await ping(ns.default);
});

// --- dynamic import ---

test('dynamic import default is the traverse function', async () => {
  const mod = await import('../lib/traverse-async.js');
  assert.equal(typeof mod.default, 'function');
  await ping(mod.default);
});

// --- returns a Promise ---

test('traverse() returns a Promise', async () => {
  const result = ping(traverse);
  assert.ok(result instanceof Promise);
  await result;
});
