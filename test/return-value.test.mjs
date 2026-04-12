import { test } from 'node:test';
import assert from 'node:assert/strict';
import traverse from '../lib/traverse-async.js';

// --- falsy non-undefined values ---

test('returning null replaces the node', async () => {
  const obj = { a: 1 };
  await traverse(obj, ({ key }) => { if (key === 'a') return null; });
  assert.equal(obj.a, null);
});

test('returning false replaces the node', async () => {
  const obj = { a: 1 };
  await traverse(obj, ({ key }) => { if (key === 'a') return false; });
  assert.equal(obj.a, false);
});

test('returning 0 replaces the node', async () => {
  const obj = { a: 1 };
  await traverse(obj, ({ key }) => { if (key === 'a') return 0; });
  assert.equal(obj.a, 0);
});

test('returning empty string replaces the node', async () => {
  const obj = { a: 'hello' };
  await traverse(obj, ({ key }) => { if (key === 'a') return ''; });
  assert.equal(obj.a, '');
});

// --- chained replacements ---

test('children of a returned object are also traversed and can be replaced', async () => {
  const obj = { a: 1 };
  await traverse(obj, ({ key, node }) => {
    if (key === 'a') return { x: 10, y: 20 };  // replace a with object
    if (key === 'x') return node * 2;            // replace x in the new object
  });
  assert.equal(obj.a.x, 20);
  assert.equal(obj.a.y, 20);
});

test('deeply chained replacements resolve correctly', async () => {
  const obj = { level: 0 };
  await traverse(obj, ({ key, node }) => {
    if (key === 'level' && node < 2) return { level: node + 1 };
  });
  // level:0 → { level:1 } → { level:2 } → 2 is not < 2, stops replacing
  assert.deepEqual(obj, { level: { level: { level: 2 } } });
});

// --- type changes ---

test('replacing an object with a primitive skips the original children', async () => {
  const visited = [];
  const obj = { a: { x: 1, y: 2 }, b: 3 };
  await traverse(obj, ({ key, node }) => {
    visited.push(key ?? 'root');
    if (key === 'a') return 99; // replace object with primitive
  });
  assert.equal(obj.a, 99);
  assert.ok(!visited.includes('x'));
  assert.ok(!visited.includes('y'));
});

test('replacing a primitive with an object causes its children to be traversed', async () => {
  const visited = [];
  const obj = { a: 1 };
  await traverse(obj, ({ key }) => {
    visited.push(key ?? 'root');
    if (key === 'a') return { x: 10, y: 20 };
  });
  assert.ok(visited.includes('x'));
  assert.ok(visited.includes('y'));
  assert.equal(obj.a.x, 10);
  assert.equal(obj.a.y, 20);
});

// --- return value vs explicit mutation ---

test('return value is applied after callback body, overriding explicit parent[key] mutation', async () => {
  const obj = { a: 1 };
  await traverse(obj, ({ key, parent }) => {
    if (key === 'a') {
      parent[key] = 'set-by-mutation';
      return 'set-by-return'; // return value wins
    }
  });
  assert.equal(obj.a, 'set-by-return');
});

// --- stop() + return value ---

test('stop() with a return value applies the replacement before halting', async () => {
  const obj = { a: 1, b: 2, c: 3 };
  const visited = [];
  await traverse(obj, ({ key, isRoot, stop }) => {
    if (isRoot) return;
    visited.push(key);
    if (key === 'a') { stop(); return 99; }
  });
  assert.equal(obj.a, 99);
  assert.ok(!visited.includes('b'));
  assert.ok(!visited.includes('c'));
});

// --- parallel correctness ---

test('parallel: concurrent replacements on siblings do not interfere', async () => {
  const obj = { a: 1, b: 2, c: 3, d: 4, e: 5 };

  await traverse(obj, async ({ key, node }) => {
    if (!key) return;
    await new Promise((r) => setTimeout(r, 10));
    return node * 10;
  }, { parallel: 5 });

  assert.equal(obj.a, 10);
  assert.equal(obj.b, 20);
  assert.equal(obj.c, 30);
  assert.equal(obj.d, 40);
  assert.equal(obj.e, 50);
});

test('parallel: replacement and traversal of returned children are consistent', async () => {
  // Each top-level node gets replaced with an object containing 'val'.
  // Those val nodes are then visited concurrently and also replaced.
  const obj = { a: 1, b: 2, c: 3 };
  const valsSeen = [];

  await traverse(obj, async ({ key, node }) => {
    if (key === 'a' || key === 'b' || key === 'c') {
      await new Promise((r) => setTimeout(r, 5));
      return { val: node * 10 };
    }
    if (key === 'val') {
      valsSeen.push(node);
      return node + 1;
    }
  }, { parallel: 3 });

  assert.deepEqual(valsSeen.sort((a, b) => a - b), [10, 20, 30]);
  assert.equal(obj.a.val, 11);
  assert.equal(obj.b.val, 21);
  assert.equal(obj.c.val, 31);
});

// --- circular reference in returned value ---

test('circular reference in a returned object is handled without infinite loop', async () => {
  const circular = { x: 1 };
  circular.self = circular;

  const obj = { a: 1 };
  const visited = [];

  await traverse(obj, ({ key }) => {
    visited.push(key ?? 'root');
    if (key === 'a') return circular;
  });

  assert.ok(visited.includes('x'));
  assert.ok(visited.includes('self'));
  assert.equal(visited.filter((k) => k === 'x').length, 1);
});

// --- returning same reference ---

test('returning the same node reference does not re-queue its children', async () => {
  const inner = { x: 1 };
  const obj = { a: inner };
  let xCount = 0;

  await traverse(obj, ({ key, node }) => {
    if (key === 'x') xCount++;
    if (key === 'a') return node; // return same object
  });

  assert.equal(xCount, 1); // x visited exactly once
});

// --- resolved tree reflects replacements ---

test('traverse() resolves with the tree reflecting all return-value replacements', async () => {
  const obj = { a: 1, b: { c: 2 } };
  const result = await traverse(obj, ({ node, key }) => {
    if (typeof node === 'number') return node * 100;
  });
  assert.equal(result, obj); // same reference
  assert.equal(result.a, 100);
  assert.equal(result.b.c, 200);
});

// --- root return value ---

test('root primitive: return value is ignored, traverse() resolves with original', async () => {
  const result = await traverse(42, ({ isRoot }) => {
    if (isRoot) return 99;
  });
  assert.equal(result, 42);
});

test('root object: return value is ignored, traverse() resolves with original', async () => {
  const obj = { a: 1 };
  const result = await traverse(obj, ({ isRoot }) => {
    if (isRoot) return { replaced: true };
  });
  assert.equal(result, obj);
  assert.equal(obj.replaced, undefined);
});

// --- async return value ---

test('async callback: returned Promise resolves to replacement value', async () => {
  const obj = { a: 1, b: 2 };
  await traverse(obj, async ({ node, key }) => {
    if (key) return Promise.resolve(node * 10);
  });
  assert.equal(obj.a, 10);
  assert.equal(obj.b, 20);
});

// --- skip() semantics with return value ---

test('skip() prevents traversal into returned object children', async () => {
  const visited = [];
  const obj = { a: 1 };
  await traverse(obj, ({ key, skip }) => {
    visited.push(key ?? 'root');
    if (key === 'a') { skip(); return { x: 10, y: 20 }; }
  });
  assert.deepEqual(obj.a, { x: 10, y: 20 }); // replacement applied
  assert.ok(!visited.includes('x'));           // but children not visited
  assert.ok(!visited.includes('y'));
});

// --- parallel + return value interaction ---

test('parallel: children are queued from the replacement, not the original', async () => {
  // With parallel:2, a and b run concurrently.
  // a is replaced with a new object — its children come from the replacement.
  // b runs independently. Neither interferes with the other's children.
  const obj = { a: { x: 1 }, b: { y: 2 } };
  const visited = [];

  await traverse(obj, async ({ key, node }) => {
    visited.push(key ?? 'root');
    await new Promise((r) => setTimeout(r, key === 'a' ? 20 : 5));
    if (key === 'a') return { x: 99 }; // replace with new object
  }, { parallel: 2 });

  assert.equal(obj.a.x, 99);     // replacement applied
  assert.equal(obj.b.y, 2);      // b unaffected
  assert.ok(visited.includes('x'));
  assert.ok(visited.includes('y'));
  assert.equal(visited.filter((k) => k === 'x').length, 1); // x visited exactly once (from replacement)
});

test('parallel: context.node is snapshotted at queue time, not at processing time', async () => {
  // With parallel:2, a and b are both dequeued before either callback runs.
  // If a's callback mutates parent.b directly, b's context.node is stale —
  // it holds the value from when b was enqueued.
  const obj = { a: 1, b: 2 };
  const seenByB = [];

  await traverse(obj, async ({ key, node, parent }) => {
    if (key === 'a') {
      await new Promise((r) => setTimeout(r, 5)); // let b dequeue first
      parent.b = 99; // direct mutation of sibling
    }
    if (key === 'b') {
      await new Promise((r) => setTimeout(r, 20)); // finish after a
      seenByB.push(node); // node was snapshotted when b was enqueued
    }
  }, { parallel: 2 });

  // context.node reflects the queued value (2), not a's later mutation (99).
  // The final value of obj.b is 99 because a mutated it directly and b
  // returned undefined (no return-value override).
  assert.equal(seenByB[0], 2);   // b saw the stale snapshot
  assert.equal(obj.b, 99);       // a's direct mutation persisted (b didn't return a value)
});

test('parallel: return value from one sibling overwrites direct mutation by another', async () => {
  // This is the footgun: if a mutates parent.b = 99, but b's callback returns 42,
  // b's finish() applies parent.b = 42 — overwriting a's mutation.
  // Last callback to finish wins.
  const obj = { a: 1, b: 2 };

  await traverse(obj, async ({ key, node, parent }) => {
    if (key === 'a') {
      parent.b = 99; // mutate sibling
    }
    if (key === 'b') {
      await new Promise((r) => setTimeout(r, 30)); // finish after a
      return 42; // return value applied last — overwrites a's mutation
    }
  }, { parallel: 2 });

  assert.equal(obj.b, 42); // b's return value won, not a's direct mutation
});

test('parallel: stop() from one sibling halts before other siblings write', async () => {
  // stop() kills the queue — other siblings' finish() calls are no-ops
  // because settled=true. Their callbacks may still run to completion,
  // but their return values are not applied.
  const obj = { a: 1, b: 2, c: 3 };
  const applied = [];

  await traverse(obj, async ({ key, isRoot, stop }) => {
    if (isRoot) return;
    if (key === 'a') { stop(); applied.push('a'); return; }
    await new Promise((r) => setTimeout(r, 30));
    applied.push(key); // b and c callbacks may still run...
    return 99;         // ...but their return values are not applied
  }, { parallel: 3 });

  // a stopped traversal; b and c may have run their callbacks but
  // finish() is a no-op after settled, so their return values are dropped
  assert.ok(!applied.includes('b') || obj.b === 2); // if b ran, its return was ignored
  assert.ok(!applied.includes('c') || obj.c === 3); // same for c
});
