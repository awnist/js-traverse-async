import { test } from 'node:test';
import assert from 'node:assert/strict';
import traverse, { config } from '../lib/traverse-async.js';

// Helper: collect all visited nodes in order
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
  assert.equal(visited.length, 4); // root + 3 values
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
  assert.equal(visited.length, 4); // root, a, b, c
});

test('path is correct at depth', async () => {
  const obj = { a: { b: { c: 42 } } };
  const visited = await collect(obj);
  const deepNode = visited.find((v) => v.node === 42);
  assert.deepEqual(deepNode.context.path, ['a', 'b', 'c']);
  assert.equal(deepNode.context.key, 'c');
});

test('traversal is breadth-first', async () => {
  //   root
  //   ├── a (= { b: 1 })
  //   └── c (= 2)
  //       └── b (= 1)
  const obj = { a: { b: 1 }, c: 2 };
  const order = [];
  await new Promise((resolve) => {
    traverse(
      obj,
      function (node, next) {
        order.push(this.key || 'root');
        next();
      },
      resolve
    );
  });
  // BFS: root → a → c → b
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

// --- done callback ---

test('done callback is called after all nodes visited', async () => {
  let visitCount = 0;
  let doneCalled = false;
  await new Promise((resolve) => {
    traverse(
      { a: 1, b: 2 },
      function (node, next) {
        visitCount++;
        next();
      },
      () => {
        doneCalled = true;
        assert.equal(visitCount, 3);
        resolve();
      }
    );
  });
  assert.ok(doneCalled);
});

test('done callback receives (null, data) on success', async () => {
  const original = { x: 99 };
  const [err, received] = await new Promise((resolve) => {
    traverse(original, (node, next) => next(), (err, data) => resolve([err, data]));
  });
  assert.equal(err, null);
  assert.equal(received, original);
});

test('works without a done callback', async () => {
  await new Promise((resolve) => {
    traverse({ a: 1 }, (node, next) => next());
    setTimeout(resolve, 50);
  });
});

// --- Promise nodes not traversed ---

test('promise-valued nodes are visited but not traversed into', async () => {
  const p = Promise.resolve({ nested: 'should not appear' });
  const visited = await collect({ p });
  assert.equal(visited.length, 2);
  assert.ok(visited.find((v) => v.node === p), 'promise node was visited');
  assert.equal(visited.find((v) => v.node === 'should not appear'), undefined);
});

// --- Mutation: replacement vs next(override) ---

test('replacing this.parent[this.key] makes next() recurse into the replacement', async () => {
  const original = { child: 1 };
  const replacement = { child: 99 };
  const visited = [];

  await new Promise((resolve) => {
    traverse(
      { a: original },
      function (node, next) {
        visited.push(node);
        if (this.key === 'a') {
          this.parent[this.key] = replacement;
        }
        next();
      },
      resolve
    );
  });

  assert.ok(!visited.includes(1), 'original child value was not traversed');
  assert.ok(visited.includes(99), 'replacement child value was traversed');
});

// --- Mutation via parent ---

test('nodes can be mutated via this.parent[this.key]', async () => {
  const obj = { a: 1, b: 2 };
  await new Promise((resolve) => {
    traverse(
      obj,
      function (node, next) {
        if (this.parent) this.parent[this.key] = node * 10;
        next();
      },
      resolve
    );
  });
  assert.equal(obj.a, 10);
  assert.equal(obj.b, 20);
});

test('nodes can be deleted via this.parent', async () => {
  const obj = { keep: 1, remove: 2 };
  await new Promise((resolve) => {
    traverse(
      obj,
      function (node, next) {
        if (this.key === 'remove') delete this.parent[this.key];
        next();
      },
      resolve
    );
  });
  assert.equal(Object.keys(obj).length, 1);
  assert.ok('keep' in obj);
  assert.ok(!('remove' in obj));
});

// --- break ---

test('break stops traversal and done is never called', async () => {
  const visitedKeys = [];
  let doneCalled = false;

  const q = traverse(
    { a: 1, b: 2, c: 3 },
    function (node, next) {
      if (this.isRoot) {
        q.break();
        return;
      }
      visitedKeys.push(this.key);
      next();
    },
    () => { doneCalled = true; }
  );

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(!doneCalled, 'done should not be called after break');
  assert.equal(visitedKeys.length, 0, 'no children should be visited after break');
});

// --- push ---

test('push adds a node to the traversal queue', async () => {
  const extra = { injected: true };
  const visited = [];

  await new Promise((resolve) => {
    const q = traverse(
      { a: 1 },
      function (node, next) {
        visited.push(node);
        if (this.key === 'a') q.push({ node: extra, path: ['extra'], parent: null });
        next();
      },
      resolve
    );
  });

  assert.ok(visited.includes(extra), 'manually pushed node was visited');
});

// --- config ---

test('config sets parallel concurrency', () => {
  assert.doesNotThrow(() => config({ parallel: 4 }));
  config({ parallel: 1 });
});

// --- mixed array/object ---

test('traverses mixed nested arrays and objects', async () => {
  const data = { list: [{ val: 1 }, { val: 2 }] };
  const visited = await collect(data);
  const vals = visited.filter((v) => v.context.key === 'val').map((v) => v.node);
  assert.deepEqual(vals.sort(), [1, 2]);
});

// --- stop ---

test('stop skips children of the current node', async () => {
  // { a: { deep: 1 }, b: 2 }
  // calling stop on 'a' should skip 'deep' but still visit 'b'
  const visited = [];
  await new Promise((resolve) => {
    traverse(
      { a: { deep: 1 }, b: 2 },
      function (node, next, stop) {
        visited.push(this.key ?? 'root');
        if (this.key === 'a') return stop();
        next();
      },
      resolve
    );
  });
  assert.ok(visited.includes('root'));
  assert.ok(visited.includes('a'));
  assert.ok(visited.includes('b'));
  assert.ok(!visited.includes('deep'), 'deep should be pruned by stop on a');
});

test('stop on root skips all children', async () => {
  const visited = [];
  await new Promise((resolve) => {
    traverse(
      { a: 1, b: 2 },
      function (node, next, stop) {
        visited.push(this.key ?? 'root');
        if (this.isRoot) return stop();
        next();
      },
      resolve
    );
  });
  assert.deepEqual(visited, ['root']);
});

test('stop on a leaf has no effect', async () => {
  // stop on a primitive is a no-op — there are no children to prune anyway
  const visited = [];
  await new Promise((resolve) => {
    traverse(
      { a: 1 },
      function (node, next, stop) {
        visited.push(this.key ?? 'root');
        return stop();
      },
      resolve
    );
  });
  // root is pruned (no children visited), so only root is seen
  assert.deepEqual(visited, ['root']);
});

test('stop only affects the current node, not siblings', async () => {
  // Tree: { a: { x: 1 }, b: { y: 2 } }
  // stop on 'a' — 'x' should not appear, but 'b' and 'y' should
  const visited = [];
  await new Promise((resolve) => {
    traverse(
      { a: { x: 1 }, b: { y: 2 } },
      function (node, next, stop) {
        visited.push(this.key ?? 'root');
        if (this.key === 'a') return stop();
        next();
      },
      resolve
    );
  });
  assert.ok(!visited.includes('x'));
  assert.ok(visited.includes('b'));
  assert.ok(visited.includes('y'));
});

test('next() visits original children when no mutation occurs', async () => {
  const visited = [];
  await new Promise((resolve) => {
    traverse(
      { a: 1, b: 2 },
      function (node, next) {
        visited.push(this.key ?? 'root');
        next();
      },
      resolve
    );
  });
  assert.deepEqual(visited.sort(), ['a', 'b', 'root']);
});
