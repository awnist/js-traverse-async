const { test } = require('node:test');
const assert = require('node:assert/strict');

const ping = (fn) =>
  new Promise((resolve) => fn({ a: 1 }, (node, next) => next(), resolve));

// --- require() styles ---

test('require returns the traverse function directly', async () => {
  const traverse = require('..');
  assert.equal(typeof traverse, 'function');
  await ping(traverse);
});

test('require: config is a property on the traverse function', () => {
  const traverse = require('..');
  assert.equal(typeof traverse.config, 'function');
});

test('require: destructure config from the traverse function', () => {
  const { config } = require('..');
  assert.equal(typeof config, 'function');
});
