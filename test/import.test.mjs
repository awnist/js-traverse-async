import { test } from 'node:test';
import assert from 'node:assert/strict';

// All static import styles under test
import traverse from '../lib/traverse-async.js';
import { config } from '../lib/traverse-async.js';
import traverse2, { config as config2 } from '../lib/traverse-async.js';
import * as ns from '../lib/traverse-async.js';

const ping = (fn) =>
  new Promise((resolve) => fn({ a: 1 }, (node, next) => next(), resolve));

// --- default import ---

test('default import is the traverse function', async () => {
  assert.equal(typeof traverse, 'function');
  await ping(traverse);
});

// --- named import ---

test('named import { config } is a function', () => {
  assert.equal(typeof config, 'function');
});

// --- combined default + named ---

test('combined import: traverse is a function', async () => {
  assert.equal(typeof traverse2, 'function');
  await ping(traverse2);
});

test('combined import: config is a function', () => {
  assert.equal(typeof config2, 'function');
});

// --- namespace import ---

test('namespace import default is the traverse function', async () => {
  assert.equal(typeof ns.default, 'function');
  await ping(ns.default);
});

test('namespace import exposes config as a named export', () => {
  assert.equal(typeof ns.config, 'function');
});

// --- dynamic import ---

test('dynamic import default is the traverse function', async () => {
  const mod = await import('../lib/traverse-async.js');
  assert.equal(typeof mod.default, 'function');
  await ping(mod.default);
});

test('dynamic import exposes config as a named export', async () => {
  const mod = await import('../lib/traverse-async.js');
  assert.equal(typeof mod.config, 'function');
});
