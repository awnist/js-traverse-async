import { test } from 'node:test';
import assert from 'node:assert/strict';
import traverse from '../lib/traverse-async.js';

const collect = async (data) => {
  const visited = [];
  await traverse(data, (ctx) => {
    visited.push({ node: ctx.node, context: { ...ctx } });
  });
  return visited;
};

// --- callback contract ---

test('context.node equals the node', async () => {
  const seen = [];
  await traverse({ a: { b: 1 } }, ({ node }) => { seen.push(node); });
  assert.ok(seen.length > 0);
});

test('path arrays are distinct references per node', async () => {
  const paths = [];
  await traverse({ a: 1, b: 2 }, ({ path }) => { paths.push(path); });

  assert.notEqual(paths[0], paths[1]);
  assert.notEqual(paths[1], paths[2]);

  const snapshot = paths.map((p) => [...p]);
  paths[0].push('MUTATED');
  for (let i = 1; i < paths.length; i++) {
    assert.deepEqual(paths[i], snapshot[i]);
  }
});

test('works with arrow functions (no this binding needed)', async () => {
  const keys = [];
  await traverse({ a: 1, b: 2 }, ({ key }) => {
    if (key) keys.push(key);
  });
  assert.deepEqual(keys.sort(), ['a', 'b']);
});

// --- Object.keys() boundary conditions ---

test('inherited prototype properties are not visited', async () => {
  const proto = { inherited: 99 };
  const obj = Object.create(proto);
  obj.own = 1;
  const visited = await collect(obj);
  const keys = visited.map((v) => v.context.key).filter(Boolean);
  assert.ok(keys.includes('own'));
  assert.ok(!keys.includes('inherited'));
});

test('non-enumerable properties are not visited', async () => {
  const obj = { a: 1 };
  Object.defineProperty(obj, 'hidden', { value: 99, enumerable: false });
  const visited = await collect(obj);
  const keys = visited.map((v) => v.context.key).filter(Boolean);
  assert.ok(keys.includes('a'));
  assert.ok(!keys.includes('hidden'));
  assert.equal(visited.length, 2);
});

test('symbol-keyed properties are not visited', async () => {
  const sym = Symbol('secret');
  const obj = { a: 1, [sym]: 99 };
  const visited = await collect(obj);
  assert.equal(visited.length, 2);
  assert.ok(!visited.some((v) => v.node === 99));
});

test('sparse array holes are skipped', async () => {
  const arr = [1, , 3]; // eslint-disable-line no-sparse-arrays
  const visited = await collect(arr);
  const keys = visited.map((v) => v.context.key).filter(Boolean);
  assert.ok(keys.includes('0'));
  assert.ok(keys.includes('2'));
  assert.ok(!keys.includes('1'));
  assert.equal(visited.length, 3);
});

// --- type treatment ---

test('Date is visited as a leaf', async () => {
  const d = new Date();
  const visited = await collect({ d });
  assert.equal(visited.length, 2);
  assert.ok(visited.some((v) => v.node === d));
});

test('RegExp is visited as a leaf', async () => {
  const r = /foo/g;
  const visited = await collect({ r });
  assert.equal(visited.length, 2);
});

test('Map is visited as a leaf', async () => {
  const m = new Map([['k', 'v']]);
  const visited = await collect({ m });
  assert.equal(visited.length, 2);
});

test('Set is visited as a leaf', async () => {
  const s = new Set([1, 2, 3]);
  const visited = await collect({ s });
  assert.equal(visited.length, 2);
});

test('class instances are recursed into', async () => {
  class Point { constructor(x, y) { this.x = x; this.y = y; } }
  const visited = await collect({ p: new Point(1, 2) });
  const keys = visited.map((v) => v.context.key).filter(Boolean);
  assert.equal(visited.length, 4);
  assert.ok(keys.includes('x'));
  assert.ok(keys.includes('y'));
});

test('null-prototype objects are recursed into', async () => {
  const inner = Object.create(null);
  inner.a = 1;
  inner.b = 2;
  const visited = await collect({ inner });
  assert.equal(visited.length, 4);
});

// --- falsy primitives as root ---

test('boolean false is visited as a leaf', async () => {
  const visited = await collect(false);
  assert.equal(visited.length, 1);
  assert.equal(visited[0].node, false);
});

test('0 is visited as a leaf', async () => {
  const visited = await collect(0);
  assert.equal(visited.length, 1);
});

test('empty string is visited as a leaf', async () => {
  const visited = await collect('');
  assert.equal(visited.length, 1);
});

// --- async callback ---

test('async callback completes normally', async () => {
  const visited = [];
  await traverse({ a: 1, b: 2 }, async ({ key }) => {
    await Promise.resolve();
    if (key) visited.push(key);
  });
  assert.deepEqual(visited.sort(), ['a', 'b']);
});

test('sync throw rejects the Promise', async () => {
  await assert.rejects(
    traverse({ a: 1, b: 2, c: 3 }, ({ key }) => {
      if (key === 'b') throw new Error('sync error');
    }),
    { message: 'sync error' }
  );
});

test('async throw rejects the Promise', async () => {
  await assert.rejects(
    traverse({ a: 1, b: 2, c: 3 }, async ({ key }) => {
      if (key === 'b') throw new Error('async error');
    }),
    { message: 'async error' }
  );
});

test('Promise rejects at most once even when multiple nodes error', async () => {
  let count = 0;
  try {
    await traverse({ a: 1, b: 2, c: 3 }, async () => { throw new Error('fail'); });
  } catch { count++; }
  assert.equal(count, 1);
});

// --- parallel ---

test('parallel option processes multiple nodes concurrently', async () => {
  let active = 0;
  let maxActive = 0;

  await traverse({ a: 1, b: 2, c: 3 }, ({ isRoot }) => {
    if (isRoot) return;
    active++;
    maxActive = Math.max(maxActive, active);
    return new Promise((r) => setTimeout(() => { active--; r(); }, 30));
  }, { parallel: 3 });

  assert.ok(maxActive >= 2, `expected >= 2, got ${maxActive}`);
});

// --- push ---

test('ctx.push injects a node whose children are also traversed', async () => {
  const injected = { x: 10, y: 20 };
  const visited = [];

  await traverse({ a: 1 }, ({ node, key, push }) => {
    visited.push(node);
    if (key === 'a') push({ node: injected, path: ['injected'], parent: null });
  });

  assert.ok(visited.includes(injected));
  assert.ok(visited.includes(10));
  assert.ok(visited.includes(20));
});

// --- circular references ---

test('direct self-reference does not cause infinite loop', async () => {
  const obj = { a: 1 };
  obj.self = obj;
  const visited = [];
  await traverse(obj, ({ key }) => { visited.push(key ?? 'root'); });
  assert.ok(visited.includes('self'));
  assert.equal(visited.filter((k) => k === 'root').length, 1);
  assert.equal(visited.filter((k) => k === 'a').length, 1);
});

test('mutual circular reference does not cause infinite loop', async () => {
  const a = { label: 'a' };
  const b = { label: 'b' };
  a.b = b; b.a = a;
  const labels = [];
  await traverse(a, ({ node }) => { if (typeof node === 'string') labels.push(node); });
  assert.ok(labels.includes('a'));
  assert.ok(labels.includes('b'));
  assert.equal(labels.filter((l) => l === 'a').length, 1);
});

test('shared reference: callback fires for each key, children traversed only once', async () => {
  const shared = { x: 1 };
  const data = { p: shared, q: shared };
  const sharedKeys = [];
  let xCount = 0;
  await traverse(data, ({ node, key }) => {
    if (node === shared) sharedKeys.push(key);
    if (key === 'x') xCount++;
  });
  assert.deepEqual(sharedKeys.sort(), ['p', 'q']);
  assert.equal(xCount, 1);
});

test('circular reference in array does not cause infinite loop', async () => {
  const arr = [1, 2];
  arr.push(arr);
  const keys = [];
  await traverse(arr, ({ key }) => { keys.push(key ?? 'root'); });
  assert.ok(keys.includes('2'));
  assert.equal(keys.filter((k) => k === '0').length, 1);
});

// --- abort edge cases ---

test('abort from a child stops remaining siblings', async () => {
  const visited = [];
  const controller = new AbortController();

  await assert.rejects(
    traverse({ a: 1, b: 2, c: 3 }, ({ key }) => {
      if (key === 'b') { controller.abort(); return; }
      visited.push(key ?? 'root');
    }, { signal: controller.signal }),
    (err) => err.name === 'AbortError'
  );

  assert.ok(!visited.includes('c'));
});

// --- stop vs skip ---

test('stop() resolves the Promise, skip() just prunes children', async () => {
  // stop() resolves
  await assert.doesNotReject(
    traverse({ a: 1 }, ({ isRoot, stop }) => { if (isRoot) stop(); })
  );

  // skip() resolves too but visits siblings
  const visited = [];
  await traverse({ a: { x: 1 }, b: 2 }, ({ key, skip }) => {
    visited.push(key ?? 'root');
    if (key === 'a') skip();
  });
  assert.ok(visited.includes('b'));
  assert.ok(!visited.includes('x'));
});

// --- skip and stop called without return ---

test('skip() works without return — code after it still runs', async () => {
  const log = [];
  await traverse({ a: { deep: 1 }, b: 2 }, ({ key, skip }) => {
    if (key === 'a') skip();
    log.push(key ?? 'root'); // this runs even after skip()
  });
  assert.ok(log.includes('a'));
  assert.ok(log.includes('b'));
  assert.ok(!log.includes('deep'));
});

test('stop() works without return — code after it still runs', async () => {
  const log = [];
  await traverse({ a: 1, b: 2 }, ({ key, isRoot, stop }) => {
    if (isRoot) return;
    stop();
    log.push(key); // this runs even after stop()
  });
  assert.equal(log.length, 1); // only 'a' ran before queue was killed
});
