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

// --- Primitives ---

test('visits a number root', async () => {
  const visited = await collect(42);
  assert.equal(visited.length, 1);
  assert.equal(visited[0].node, 42);
});

test('visits a string root', async () => {
  const visited = await collect('hello');
  assert.equal(visited.length, 1);
  assert.equal(visited[0].node, 'hello');
});

test('visits null as a leaf', async () => {
  const visited = await collect(null);
  assert.equal(visited.length, 1);
  assert.equal(visited[0].node, null);
});

test('visits undefined as a leaf', async () => {
  const visited = await collect(undefined);
  assert.equal(visited.length, 1);
  assert.equal(visited[0].node, undefined);
});

// --- Root context ---

test('root node has isRoot: true', async () => {
  const visited = await collect({ a: 1 });
  const root = visited.find((v) => v.context.isRoot);
  assert.ok(root, 'root entry exists');
  assert.deepEqual(root.context.path, []);
  assert.equal(root.context.key, undefined);
  assert.equal(root.context.parent, undefined);
});

test('root node has empty path', async () => {
  const visited = await collect(42);
  assert.deepEqual(visited[0].context.path, []);
});

// --- Flat object ---

test('visits all keys of a flat object', async () => {
  const obj = { a: 1, b: 2, c: 3 };
  const visited = await collect(obj);
  const nodes = visited.map((v) => v.node);
  assert.ok(nodes.includes(obj));
  assert.ok(nodes.includes(1));
  assert.ok(nodes.includes(2));
  assert.ok(nodes.includes(3));
  assert.equal(visited.length, 4);
});

test('child key names are correct', async () => {
  const obj = { x: 10, y: 20 };
  const visited = await collect(obj);
  const children = visited.filter((v) => !v.context.isRoot);
  const keys = children.map((v) => v.context.key).sort();
  assert.deepEqual(keys, ['x', 'y']);
});

test('child paths are correct', async () => {
  const obj = { x: 10, y: 20 };
  const visited = await collect(obj);
  const children = visited.filter((v) => !v.context.isRoot);
  const paths = children.map((v) => v.context.path).sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(paths, [['x'], ['y']]);
});

test('child parent references the parent object', async () => {
  const obj = { a: 1 };
  const visited = await collect(obj);
  const child = visited.find((v) => v.context.key === 'a');
  assert.equal(child.context.parent, obj);
});

// --- Flat array ---

test('visits all elements of a flat array', async () => {
  const arr = [10, 20, 30];
  const visited = await collect(arr);
  const nodes = visited.map((v) => v.node);
  assert.ok(nodes.includes(arr));
  assert.ok(nodes.includes(10));
  assert.ok(nodes.includes(20));
  assert.ok(nodes.includes(30));
  assert.equal(visited.length, 4);
});

test('array element keys are string indices', async () => {
  const arr = ['a', 'b', 'c'];
  const visited = await collect(arr);
  const children = visited.filter((v) => !v.context.isRoot);
  const keys = children.map((v) => v.context.key).sort();
  assert.deepEqual(keys, ['0', '1', '2']);
});

test('array element paths are correct', async () => {
  const arr = ['a', 'b'];
  const visited = await collect(arr);
  const child0 = visited.find((v) => v.context.key === '0');
  const child1 = visited.find((v) => v.context.key === '1');
  assert.deepEqual(child0.context.path, ['0']);
  assert.deepEqual(child1.context.path, ['1']);
});

// --- Nested structures ---

test('visits all nodes in a nested object', async () => {
  const obj = { a: { b: { c: 42 } } };
  const visited = await collect(obj);
  assert.equal(visited.length, 4);
});

test('path is correct at depth', async () => {
  const obj = { a: { b: { c: 42 } } };
  const visited = await collect(obj);
  const deepNode = visited.find((v) => v.node === 42);
  assert.deepEqual(deepNode.context.path, ['a', 'b', 'c']);
  assert.equal(deepNode.context.key, 'c');
});

test('traversal is breadth-first', async () => {
  const obj = { a: { b: 1 }, c: 2 };
  const order = [];
  await traverse(obj, ({ key }) => { order.push(key ?? 'root'); });
  assert.deepEqual(order, ['root', 'a', 'c', 'b']);
});

// --- Empty containers ---

test('empty object produces only root visit', async () => {
  const visited = await collect({});
  assert.equal(visited.length, 1);
  assert.deepEqual(visited[0].node, {});
});

test('empty array produces only root visit', async () => {
  const visited = await collect([]);
  assert.equal(visited.length, 1);
  assert.deepEqual(visited[0].node, []);
});

// --- Promise return ---

test('traverse returns a Promise', () => {
  const result = traverse({ a: 1 }, () => {});
  assert.ok(result instanceof Promise);
  return result;
});

test('Promise resolves with the original data', async () => {
  const original = { x: 99 };
  const received = await traverse(original, () => {});
  assert.equal(received, original);
});

test('Promise resolves after all nodes are visited', async () => {
  let visitCount = 0;
  await traverse({ a: 1, b: 2 }, () => { visitCount++; });
  assert.equal(visitCount, 3);
});

test('works without awaiting', async () => {
  traverse({ a: 1 }, () => {});
  await new Promise((resolve) => setTimeout(resolve, 50));
});

// --- Promise nodes not traversed ---

test('promise-valued nodes are visited but not traversed into', async () => {
  const p = Promise.resolve({ nested: 'should not appear' });
  const visited = await collect({ p });
  assert.equal(visited.length, 2);
  assert.ok(visited.find((v) => v.node === p));
  assert.equal(visited.find((v) => v.node === 'should not appear'), undefined);
});

// --- Mutation ---

test('replacing parent[key] makes traversal recurse into the replacement', async () => {
  const original = { child: 1 };
  const replacement = { child: 99 };
  const visited = [];

  await traverse({ a: original }, ({ node, key, parent }) => {
    visited.push(node);
    if (key === 'a') parent[key] = replacement;
  });

  assert.ok(!visited.includes(1));
  assert.ok(visited.includes(99));
});

test('nodes can be mutated via parent[key]', async () => {
  const obj = { a: 1, b: 2 };
  await traverse(obj, ({ node, key, parent }) => {
    if (parent) parent[key] = node * 10;
  });
  assert.equal(obj.a, 10);
  assert.equal(obj.b, 20);
});

test('nodes can be deleted via parent', async () => {
  const obj = { keep: 1, remove: 2 };
  await traverse(obj, ({ key, parent }) => {
    if (key === 'remove') delete parent[key];
  });
  assert.equal(Object.keys(obj).length, 1);
  assert.ok('keep' in obj);
  assert.ok(!('remove' in obj));
});

// --- return value as replacement ---

test('returning a value replaces the node', async () => {
  const obj = { a: 1, b: 2 };
  await traverse(obj, ({ node, key }) => {
    if (key) return node * 10;
  });
  assert.equal(obj.a, 10);
  assert.equal(obj.b, 20);
});

test('returning undefined leaves the node unchanged', async () => {
  const obj = { a: 1, b: 2 };
  await traverse(obj, ({ key }) => {
    if (key === 'a') return 99;
    // no return for b — should stay as 2
  });
  assert.equal(obj.a, 99);
  assert.equal(obj.b, 2);
});

test('returning an object causes traversal to recurse into it', async () => {
  const obj = { a: 1 };
  await traverse(obj, ({ node, key }) => {
    if (key === 'a') return { x: 10, y: 20 };
  });
  assert.deepEqual(obj.a, { x: 10, y: 20 });
});

test('async callback: returned value replaces the node', async () => {
  const obj = { a: 'hello', b: 'world' };
  await traverse(obj, async ({ node, key }) => {
    if (key) {
      await Promise.resolve();
      return node.toUpperCase();
    }
  });
  assert.equal(obj.a, 'HELLO');
  assert.equal(obj.b, 'WORLD');
});

test('returning a value at root is ignored (no parent to assign into)', async () => {
  const obj = { a: 1 };
  const result = await traverse(obj, ({ isRoot }) => {
    if (isRoot) return { replaced: true };
  });
  assert.equal(result, obj);
  assert.equal(obj.a, 1);
  assert.equal(obj.replaced, undefined);
});

test('skip() with a return value replaces node but skips children', async () => {
  const obj = { a: { deep: 1 }, b: 2 };
  const visited = [];
  await traverse(obj, ({ key, skip }) => {
    visited.push(key ?? 'root');
    if (key === 'a') { skip(); return { replaced: true }; }
  });
  assert.deepEqual(obj.a, { replaced: true });
  assert.ok(!visited.includes('deep'));
  assert.ok(!visited.includes('replaced'));
});

// --- skip arrays ---

test('skip() on an array prevents its elements from being visited', async () => {
  const data = { items: [1, 2, 3], name: 'test' };
  const visited = [];
  await traverse(data, ({ node, key, skip }) => {
    visited.push(key ?? 'root');
    if (Array.isArray(node)) return skip();
  });
  assert.ok(visited.includes('items'));
  assert.ok(visited.includes('name'));
  assert.ok(!visited.includes('0'));
  assert.ok(!visited.includes('1'));
  assert.ok(!visited.includes('2'));
});

test('skip() on arrays at any depth', async () => {
  const data = { a: { list: [10, 20], b: 1 } };
  const visited = [];
  await traverse(data, ({ node, key, skip }) => {
    visited.push(key ?? 'root');
    if (Array.isArray(node)) return skip();
  });
  assert.ok(visited.includes('list'));
  assert.ok(visited.includes('b'));
  assert.ok(!visited.includes('0'));
  assert.ok(!visited.includes('1'));
});

test('skipping arrays does not affect sibling object nodes', async () => {
  const data = { arr: [1, 2], obj: { x: 1 } };
  const visited = [];
  await traverse(data, ({ node, key, skip }) => {
    visited.push(key ?? 'root');
    if (Array.isArray(node)) return skip();
  });
  assert.ok(visited.includes('x'));
});

// --- skip ---

test('calling skip() skips children of the current node', async () => {
  const visited = [];
  await traverse({ a: { deep: 1 }, b: 2 }, ({ key, skip }) => {
    visited.push(key ?? 'root');
    if (key === 'a') skip();
  });
  assert.ok(visited.includes('root'));
  assert.ok(visited.includes('a'));
  assert.ok(visited.includes('b'));
  assert.ok(!visited.includes('deep'));
});

test('return skip() also skips children', async () => {
  const visited = [];
  await traverse({ a: { deep: 1 }, b: 2 }, ({ key, skip }) => {
    visited.push(key ?? 'root');
    if (key === 'a') return skip();
  });
  assert.ok(visited.includes('root'));
  assert.ok(visited.includes('a'));
  assert.ok(visited.includes('b'));
  assert.ok(!visited.includes('deep'));
});

test('skip() on root skips all children', async () => {
  const visited = [];
  await traverse({ a: 1, b: 2 }, ({ key, isRoot, skip }) => {
    visited.push(key ?? 'root');
    if (isRoot) skip();
  });
  assert.deepEqual(visited, ['root']);
});

test('skip() on a leaf has no effect', async () => {
  const visited = [];
  await traverse({ a: 1 }, ({ key, skip }) => {
    visited.push(key ?? 'root');
    if (key === 'a') skip(); // a is a leaf — skip has nothing to prune
  });
  assert.deepEqual(visited, ['root', 'a']);
});

test('skip() only affects the current node, not siblings', async () => {
  const visited = [];
  await traverse({ a: { x: 1 }, b: { y: 2 } }, ({ key, skip }) => {
    visited.push(key ?? 'root');
    if (key === 'a') skip();
  });
  assert.ok(!visited.includes('x'));
  assert.ok(visited.includes('b'));
  assert.ok(visited.includes('y'));
});

// --- stop ---

test('calling stop() resolves the Promise immediately', async () => {
  const visited = [];
  await traverse({ a: 1, b: 2, c: 3 }, ({ key, isRoot, stop }) => {
    if (isRoot) return;
    visited.push(key);
    if (key === 'a') stop();
  });
  assert.ok(!visited.includes('b'));
  assert.ok(!visited.includes('c'));
});

test('return stop() also stops traversal', async () => {
  const visited = [];
  await traverse({ a: 1, b: 2, c: 3 }, ({ key, isRoot, stop }) => {
    if (isRoot) return;
    visited.push(key);
    if (key === 'a') return stop();
  });
  assert.ok(!visited.includes('b'));
  assert.ok(!visited.includes('c'));
});

test('stop() resolves rather than rejects', async () => {
  const result = await traverse({ a: 1 }, ({ isRoot, stop }) => {
    if (isRoot) stop();
  });
  assert.equal(result.a, 1);
});

// --- abort ---

test('AbortSignal rejects with AbortError', async () => {
  const controller = new AbortController();
  await assert.rejects(
    traverse({ a: 1, b: 2 }, ({ isRoot }) => {
      if (isRoot) controller.abort();
    }, { signal: controller.signal }),
    (err) => err.name === 'AbortError'
  );
});

test('AbortSignal.timeout() rejects when exceeded', async () => {
  await assert.rejects(
    traverse({ a: 1 }, () => new Promise(() => {}), { signal: AbortSignal.timeout(50) }),
    (err) => err.name === 'AbortError' || err.name === 'TimeoutError'
  );
});

test('already-aborted signal rejects immediately', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    traverse({ a: 1 }, () => {}, { signal: controller.signal }),
    (err) => err.name === 'AbortError'
  );
});

// --- push ---

test('ctx.push adds a node to the traversal queue', async () => {
  const extra = { injected: true };
  const visited = [];

  await traverse({ a: 1 }, ({ node, key, push }) => {
    visited.push(node);
    if (key === 'a') push({ node: extra, path: ['extra'], parent: null });
  });

  assert.ok(visited.includes(extra));
});

// --- parallel option ---

test('parallel option allows concurrent processing', async () => {
  let active = 0;
  let maxActive = 0;

  await new Promise((resolve, reject) => {
    traverse({ a: 1, b: 2, c: 3 }, ({ isRoot }) => {
      if (isRoot) return;
      active++;
      maxActive = Math.max(maxActive, active);
      return new Promise((r) => setTimeout(() => { active--; r(); }, 30));
    }, { parallel: 3 }).then(resolve).catch(reject);
  });

  assert.ok(maxActive >= 2, `expected >= 2 concurrent nodes, got ${maxActive}`);
});

// --- mixed array/object ---

test('traverses mixed nested arrays and objects', async () => {
  const data = { list: [{ val: 1 }, { val: 2 }] };
  const visited = await collect(data);
  const vals = visited.filter((v) => v.context.key === 'val').map((v) => v.node);
  assert.deepEqual(vals.sort(), [1, 2]);
});

// --- error handling ---

test('sync throw rejects the Promise', async () => {
  await assert.rejects(
    traverse({ a: 1 }, ({ key }) => { if (key === 'a') throw new Error('sync error'); }),
    { message: 'sync error' }
  );
});

test('async throw rejects the Promise', async () => {
  await assert.rejects(
    traverse({ a: 1 }, async ({ key }) => { if (key === 'a') throw new Error('async error'); }),
    { message: 'async error' }
  );
});
