import { test } from 'node:test';
import assert from 'node:assert/strict';
import traverse, { config } from '../lib/traverse-async.js';

const collect = (data) =>
  new Promise((resolve) => {
    const visited = [];
    traverse(
      data,
      function (node, next) {
        visited.push({ node, context: { ...this } });
        next();
      },
      () => resolve(visited)
    );
  });

// --- callback contract ---

test('this.node equals the node argument', async () => {
  await new Promise((resolve) => {
    traverse(
      { a: { b: 1 } },
      function (node, next) {
        assert.equal(this.node, node);
        next();
      },
      resolve
    );
  });
});

test('path arrays are distinct references per node', async () => {
  const paths = [];
  await new Promise((resolve) => {
    traverse({ a: 1, b: 2 }, function (node, next) {
      paths.push(this.path);
      next();
    }, resolve);
  });

  // All path references are distinct objects
  assert.notEqual(paths[0], paths[1]);
  assert.notEqual(paths[1], paths[2]);

  // Mutating one does not corrupt the others
  const snapshot = paths.map((p) => [...p]);
  paths[0].push('MUTATED');
  for (let i = 1; i < paths.length; i++) {
    assert.deepEqual(paths[i], snapshot[i]);
  }
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
  assert.equal(visited.length, 2); // root + a
});

test('symbol-keyed properties are not visited', async () => {
  const sym = Symbol('secret');
  const obj = { a: 1, [sym]: 99 };
  const visited = await collect(obj);
  assert.equal(visited.length, 2); // root + a
  assert.ok(!visited.some((v) => v.node === 99));
});

test('sparse array holes are skipped', async () => {
  // Object.keys([1,,3]) === ['0', '2'] — index 1 is absent
  const arr = [1, , 3]; // eslint-disable-line no-sparse-arrays
  const visited = await collect(arr);
  const keys = visited.map((v) => v.context.key).filter(Boolean);
  assert.ok(keys.includes('0'));
  assert.ok(keys.includes('2'));
  assert.ok(!keys.includes('1'));
  assert.equal(visited.length, 3); // root + index 0 + index 2
});

// --- type treatment: leaf vs. container ---

test('Date is visited as a leaf, not recursed into', async () => {
  const d = new Date();
  const visited = await collect({ d });
  assert.equal(visited.length, 2); // root + d
  assert.ok(visited.some((v) => v.node === d));
});

test('RegExp is visited as a leaf, not recursed into', async () => {
  const r = /foo/g;
  const visited = await collect({ r });
  assert.equal(visited.length, 2);
  assert.ok(visited.some((v) => v.node === r));
});

test('Map is visited as a leaf, not recursed into', async () => {
  const m = new Map([['k', 'v']]);
  const visited = await collect({ m });
  assert.equal(visited.length, 2);
  assert.ok(visited.some((v) => v.node === m));
});

test('Set is visited as a leaf, not recursed into', async () => {
  const s = new Set([1, 2, 3]);
  const visited = await collect({ s });
  assert.equal(visited.length, 2);
  assert.ok(visited.some((v) => v.node === s));
});

test('class instances are recursed into', async () => {
  class Point {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
  }
  const visited = await collect({ p: new Point(1, 2) });
  const keys = visited.map((v) => v.context.key).filter(Boolean);
  // root, p, x, y
  assert.equal(visited.length, 4);
  assert.ok(keys.includes('x'));
  assert.ok(keys.includes('y'));
});

test('null-prototype objects are recursed into', async () => {
  const inner = Object.create(null);
  inner.a = 1;
  inner.b = 2;
  const visited = await collect({ inner });
  // root, inner, a, b
  assert.equal(visited.length, 4);
  const keys = visited.map((v) => v.context.key).filter(Boolean);
  assert.ok(keys.includes('a'));
  assert.ok(keys.includes('b'));
});

// --- falsy primitives as root ---

test('boolean false is visited as a leaf', async () => {
  const visited = await collect(false);
  assert.equal(visited.length, 1);
  assert.equal(visited[0].node, false);
});

test('boolean true is visited as a leaf', async () => {
  const visited = await collect(true);
  assert.equal(visited.length, 1);
  assert.equal(visited[0].node, true);
});

test('0 is visited as a leaf', async () => {
  const visited = await collect(0);
  assert.equal(visited.length, 1);
  assert.equal(visited[0].node, 0);
});

test('empty string is visited as a leaf', async () => {
  const visited = await collect('');
  assert.equal(visited.length, 1);
  assert.equal(visited[0].node, '');
});

// --- async callback ---

test('next() called after async delay still advances traversal', async () => {
  const order = [];
  await new Promise((resolve) => {
    traverse(
      { a: 1, b: 2 },
      function (node, next) {
        order.push(this.key ?? 'root');
        setTimeout(next, 10);
      },
      resolve
    );
  });
  assert.equal(order.length, 3); // root, a, b
  assert.equal(order[0], 'root');
});

test('async callback that awaits before calling next() completes normally', async () => {
  const visited = [];
  await new Promise((resolve) => {
    traverse(
      { a: 1, b: 2 },
      async function (node, next) {
        await Promise.resolve(); // simulate async work
        visited.push(this.key ?? 'root');
        next();
      },
      (err) => { if (!err) resolve(); }
    );
  });
  assert.deepEqual(visited.sort(), ['a', 'b', 'root']);
});

test('sync callback that throws aborts traversal and calls done with the error', async () => {
  const [err] = await new Promise((resolve) => {
    traverse(
      { a: 1, b: 2, c: 3 },
      function (node, next) {
        if (this.key === 'b') throw new Error('sync error');
        next();
      },
      (err, data) => resolve([err, data])
    );
  });
  assert.ok(err instanceof Error);
  assert.equal(err.message, 'sync error');
});

test('async callback that rejects aborts traversal and calls done with the error', async () => {
  const [err] = await new Promise((resolve) => {
    traverse(
      { a: 1, b: 2, c: 3 },
      async function (node, next) {
        if (this.key === 'b') throw new Error('async error');
        next();
      },
      (err, data) => resolve([err, data])
    );
  });
  assert.ok(err instanceof Error);
  assert.equal(err.message, 'async error');
});

test('done is called at most once even when multiple nodes error', async () => {
  let callCount = 0;
  await new Promise((resolve) => {
    traverse(
      { a: 1, b: 2, c: 3 },
      async function (node, next) {
        throw new Error('always fails');
      },
      () => {
        callCount++;
        setTimeout(resolve, 50); // wait to confirm no further calls arrive
      }
    );
  });
  assert.equal(callCount, 1);
});

// --- parallel concurrency ---

test('parallel > 1 processes multiple nodes concurrently', async () => {
  config({ parallel: 2 });

  let active = 0;
  let maxActive = 0;

  await new Promise((resolve) => {
    traverse(
      { a: 1, b: 2, c: 3 },
      function (node, next) {
        if (this.isRoot) return next();
        active++;
        maxActive = Math.max(maxActive, active);
        setTimeout(() => {
          active--;
          next();
        }, 30);
      },
      resolve
    );
  });

  config({ parallel: 1 });
  assert.ok(maxActive >= 2, `expected >= 2 concurrent nodes, got ${maxActive}`);
});

// --- push edge cases ---

test('manually pushed object node has its own children traversed', async () => {
  const injected = { x: 10, y: 20 };
  const visited = [];

  await new Promise((resolve) => {
    const q = traverse(
      { a: 1 },
      function (node, next) {
        visited.push(node);
        if (this.key === 'a') q.push({ node: injected, path: ['injected'], parent: null });
        next();
      },
      resolve
    );
  });

  assert.ok(visited.includes(injected), 'injected node was visited');
  assert.ok(visited.includes(10), 'child x of injected node was visited');
  assert.ok(visited.includes(20), 'child y of injected node was visited');
});

test('push after done causes done to fire again', async () => {
  let doneCount = 0;
  let q;

  await new Promise((resolve) => {
    q = traverse(
      { a: 1 },
      (node, next) => next(),
      () => {
        doneCount++;
        if (doneCount === 1) {
          q.push({ node: 99, path: ['late'], parent: null });
        } else {
          resolve();
        }
      }
    );
  });

  assert.equal(doneCount, 2);
});

// --- circular references ---

test('direct self-reference does not cause infinite loop', async () => {
  const obj = { a: 1 };
  obj.self = obj; // obj.self → obj (circular)
  const visited = [];
  await new Promise((resolve) => {
    traverse(obj, function (node, next) {
      visited.push(this.key ?? 'root');
      next();
    }, resolve);
  });
  // 'self' is visited (the callback fires), but obj is not recursed into again
  assert.ok(visited.includes('self'), 'circular key is visited');
  assert.equal(visited.filter((k) => k === 'root').length, 1, 'root visited exactly once');
  assert.equal(visited.filter((k) => k === 'a').length, 1, 'a visited exactly once');
});

test('mutual circular reference does not cause infinite loop', async () => {
  const a = { label: 'a' };
  const b = { label: 'b' };
  a.b = b;
  b.a = a; // a → b → a → ...
  const labels = [];
  await new Promise((resolve) => {
    traverse(a, function (node, next) {
      if (typeof node === 'string') labels.push(node);
      next();
    }, resolve);
  });
  assert.ok(labels.includes('a'));
  assert.ok(labels.includes('b'));
  // 'a' should appear only once despite the cycle
  assert.equal(labels.filter((l) => l === 'a').length, 1);
});

test('shared reference: callback fires for each key, children traversed only once', async () => {
  const shared = { x: 1 };
  const data = { p: shared, q: shared }; // same object, two keys
  const sharedVisitKeys = [];
  const xVisitCount = { count: 0 };
  await new Promise((resolve) => {
    traverse(data, function (node, next) {
      if (node === shared) sharedVisitKeys.push(this.key);
      if (this.key === 'x') xVisitCount.count++;
      next();
    }, resolve);
  });
  // callback fires for shared twice (once as 'p', once as 'q')
  assert.deepEqual(sharedVisitKeys.sort(), ['p', 'q']);
  // but children are only pushed once (WeakSet prevents double-recursion)
  assert.equal(xVisitCount.count, 1);
});

test('circular reference in array does not cause infinite loop', async () => {
  const arr = [1, 2];
  arr.push(arr); // arr[2] → arr (circular)
  const keys = [];
  await new Promise((resolve) => {
    traverse(arr, function (node, next) {
      keys.push(this.key ?? 'root');
      next();
    }, resolve);
  });
  assert.ok(keys.includes('2'), 'circular index is visited');
  // arr itself should only be recursed into once
  assert.equal(keys.filter((k) => k === '0').length, 1);
});

test('deeply nested circular reference does not cause infinite loop', async () => {
  const root = { a: { b: { c: {} } } };
  root.a.b.c.back = root.a; // c.back → a (not the root, but still a cycle)
  const visited = [];
  await new Promise((resolve) => {
    traverse(root, function (node, next) {
      visited.push(this.key ?? 'root');
      next();
    }, resolve);
  });
  assert.ok(visited.includes('back'), 'back-reference key is visited');
  // 'b' should appear exactly once despite the cycle via back
  assert.equal(visited.filter((k) => k === 'b').length, 1);
});

// --- break edge cases ---

test('break from a child stops remaining siblings', async () => {
  const visited = [];
  let doneCalled = false;

  // BFS order: root → a → b → c
  // break at 'b' — 'c' should never be visited
  const q = traverse(
    { a: 1, b: 2, c: 3 },
    function (node, next) {
      if (this.key === 'b') {
        q.break();
        return;
      }
      visited.push(this.key ?? 'root');
      next();
    },
    () => { doneCalled = true; }
  );

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(!doneCalled);
  assert.ok(!visited.includes('c'), 'c should not be visited after break at b');
});
