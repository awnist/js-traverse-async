const { test } = require('node:test');
const assert = require('node:assert/strict');

const ping = (fn) => fn({ a: 1 }, () => {});

test('require returns the traverse function directly', async () => {
  const traverse = require('..');
  assert.equal(typeof traverse, 'function');
  await ping(traverse);
});

test('require: traverse() returns a Promise', async () => {
  const traverse = require('..');
  const result = ping(traverse);
  assert.ok(result instanceof Promise);
  await result;
});
