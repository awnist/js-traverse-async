# traverse-async

When you have a deeply nested object like a config tree, an API response, or document model, and need to do something at every level of it, writing the recursion yourself gets tedious. It gets harder still when the work at each node is asynchronous: a database lookup, a file read, a network call.

`traverse-async` handles the recursion for you. Give it any object or array and a callback, and it walks every node from the root down, waiting for your callback to call `next()` before moving on. You can do async work inside the callback, skip a subtree by calling `stop()` instead, or kill the whole traversal early, without any of the bookkeeping.

## Installation

```sh
pnpm add traverse-async
# or
npm install traverse-async
```

## Usage

```js
import traverse, { config } from 'traverse-async'; // ESM
const traverse = require('traverse-async');         // CJS
```

### Basic walk

```js
traverse({ a: { b: { c: 1 } }, d: 2 }, function (node, next) {
  console.log(this.path.join('.') || '(root)', '->', node);
  next();
}, () => {
  console.log('done');
});
// (root) -> { a: { b: { c: 1 } }, d: 2 }
// a     -> { b: { c: 1 } }
// d     -> 2
// a.b   -> { c: 1 }
// a.b.c -> 1
// done
```

### Knowing when traversal is complete

Pass a third argument to `traverse()` — a `done(err, data)` callback that fires once every node has been visited. `err` is `null` on success; `data` is the original value passed as the first argument.

```js
traverse(data, function (node, next) {
  next();
}, (err, data) => {
  if (err) {
    console.error('failed:', err);
  } else {
    console.log('finished', data);
  }
});
```

To use `await` instead, wrap the traversal in a `Promise`:

```js
await new Promise((resolve, reject) => {
  traverse(data, function (node, next) {
    next();
  }, (err, data) => err ? reject(err) : resolve(data));
});

// execution continues here once all nodes are visited
```

If you only care about side effects and don't need to know when it finishes, the third argument can be omitted entirely.

### Async callback

The callback can be an `async` function. The return value is ignored — `next()` is what drives the queue forward, not promise resolution. Traversal pauses on each node until `next()` or `stop()` is called.

```js
traverse(data, async function (node, next) {
  if (node?.url) {
    node.data = await fetch(node.url).then(r => r.json());
  }
  next();
}, (err) => { if (!err) console.log('all nodes processed'); });
```

#### Error handling

If the callback throws synchronously, or returns a promise that rejects, the traversal is automatically aborted and `done` is called with the error. No further nodes are visited and `done` is not called again.

```js
traverse(data, async function (node, next) {
  const result = await fetch(node.url); // may throw
  node.data = await result.json();
  next();
}, (err, data) => {
  if (err) console.error('traversal failed:', err);
  else console.log('done', data);
});
```

### Skipping a subtree with stop()

Call `stop()` instead of `next()` to visit the current node but skip all of its descendants. The rest of the traversal carries on normally.

```js
traverse({ a: { b: { c: 1 } }, d: 2 }, function (node, next, stop) {
  console.log(this.path.join('.') || '(root)');
  if (this.key === 'a') return stop(); // skip everything inside a
  next();
});
// (root)
// a        ← visited, but b and c are never reached
// d
```

## API

### `traverse(data, callback, [done])` → `queue`

Walks every node in `data` breadth-first, calling `callback` once per node.


| Parameter                    | Type                | Description                                                                                                                                                            |
| ---------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data`                       | any                 | The root value to traverse. Objects and arrays are recursed into; primitives are visited as leaves.                                                                    |
| `callback(node, next, stop)` | function            | Called for each node. `this` is the [node context](#context). Must call `next()` or `stop()` to advance.                                                               |
| `done(err, data)`            | function (optional) | Called when traversal completes or errors. On success: `err` is `null`, `data` is the original value. On error: `err` is the thrown value, traversal has been aborted. |


**Returns** an object `{ break, push }` that lets you control the live traversal. See [Queue handle](#queue-handle) below.

#### `next()`

Recurse into the node's children and advance the queue. If the callback replaced the node via `this.parent[this.key] = replacement` before calling `next()`, the replacement is what gets traversed.

#### `stop()`

Skip the current node's children and advance the queue. The node itself has already been visited; `stop()` just prevents descending into it. Siblings and the rest of the tree are unaffected.

```js
traverse(data, function (node, next, stop) {
  if (this.key === 'something') return stop(); // skip private subtrees
  next();
});
```

`stop()` is the right tool when you want to prune a branch — for example, skipping already-processed subtrees, avoiding large blobs, or short-circuiting once a condition is met within a subtree.

---

### Context (`this` inside callback)

Inside the callback, `this` describes the current node's position in the tree.

#### `this.node`

The current value being visited. Same as the first callback argument `node`.

#### `this.key`

The string key or array index under which this node lives in its parent. `undefined` for the root.

```js
// data = { users: [{ name: 'alice' }] }
// visiting 'alice':  this.key === 'name'
// visiting the array: this.key === 'users'
// visiting the root:  this.key === undefined
```

#### `this.parent`

The object or array that contains this node. `undefined` for the root. Use `this.parent[this.key]` to read or replace the node in place.

```js
// Delete the current node from its parent
delete this.parent[this.key];

// Replace the current node and let next() traverse the replacement
this.parent[this.key] = { some: "other value" };
next();
```

#### `this.path`

Array of keys from the root down to the current node. Empty array `[]` for the root.

```js
// data = { a: { b: { c: 1 } } }
// visiting c:    this.path === ['a', 'b', 'c']
// visiting b:    this.path === ['a', 'b']
// visiting root: this.path === []

this.path.join('.') // 'a.b.c'
```

#### `this.isRoot`

`true` only for the root node, `false` for everything else. Useful for skipping the root in callbacks that should only act on children.

```js
function (node, next) {
  if (this.isRoot) return next();
  // ... handle non-root nodes
}
```

---

### Queue handle

`traverse()` returns `{ break, push }` — two methods for controlling the live traversal from inside or outside the callback.

#### `queue.break()`

Kills the queue immediately. No further nodes are visited and `done` is never called.

```js
const queue = traverse(data, function (node, next) {
  if (node?.value === 'something') {
    queue.break(); // stop everything
    return;        // do not call next()
  }
  next();
});
```

#### `queue.push(context)`

Injects an additional node into the traversal queue. The context object follows the same shape as the internal node context (`node`, `path`, `parent`, `key`).

```js
const queue = traverse(data, function (node, next) {
  if (node?.value === 'something') {
    // inject a synthetic summary node after each section
    queue.push({ node: { count: node.items.length }, path: [...this.path, 'summary'], parent: node });
  }
  next();
});
```

---

### `config(options)`

Sets global options that apply to all subsequent `traverse()` calls.

```js
import { config } from 'traverse-async';

config({ parallel: 4 }); // process up to 4 nodes concurrently
```


| Option     | Type   | Default | Description                             |
| ---------- | ------ | ------- | --------------------------------------- |
| `parallel` | number | `1`     | Number of nodes processed concurrently. |


---

## Traversal behaviour

- **Order**: breadth-first (BFS). A node's children are queued before the callback for that node returns.
- **Objects and arrays** are recursed into. Their keys/indices are visited as child nodes.
- **Primitives** (`string`, `number`, `boolean`, `null`, `undefined`) are visited as leaves with no children.
- **Promises** (any object with a `.then` method) are visited as leaves — their internals are not traversed.
- **Only own enumerable string keys** are visited. Inherited, non-enumerable, and symbol-keyed properties are skipped.
- **Sparse array holes** are skipped (`[1,,3]` visits indices `0` and `2` only).
- **Class instances** are recursed into (they are plain objects as far as `toString` is concerned).
- **Date, RegExp, Map, Set** are treated as leaves and not recursed into.
- **Circular references** are detected via a per-traversal `WeakSet`. A node whose object reference has already been recursed into is visited (the callback fires) but its children are not queued again, preventing infinite loops.
- **Shared references** (same object reachable via multiple keys) follow the same rule: the callback fires once per key, but children are only queued the first time the object is encountered.
- **Mutation**: assigning to `this.parent[this.key]` updates the parent container, and `next()` will recurse into whatever is now in that slot — so replacing a node and calling `next()` naturally traverses the replacement.
- **Concurrency**: default is serial (`parallel: 1`). Increase via `config()` for independent async work.

---

## Examples

### Redact sensitive fields before logging

Strip passwords, tokens, and secrets from a payload at any nesting depth before it reaches a logger or external service. `stop()` avoids recursing into the now-redacted value.

```js
const SENSITIVE = new Set(['password', 'token', 'secret', 'apiKey']);

traverse(payload, function (node, next, stop) {
  if (SENSITIVE.has(this.key)) {
    this.parent[this.key] = '[redacted]';
    return stop();
  }
  next();
}, () => logger.info(payload));
```

### Interpolate environment variables in a config object

Walk a loaded config and replace `${VAR}` placeholders with real values before the app starts.

```js
const ENV_PLACEHOLDER = /\$\{([^}]+)\}/g;

traverse(config, function (node, next) {
  if (typeof node === 'string') {
    this.parent[this.key] = node.replace(
      ENV_PLACEHOLDER,
      (_, name) => process.env[name] ?? ''
    );
  }
  next();
}, () => startApp(config));
```

### Replace a node and traverse the replacement

Assign a new value to `this.parent[this.key]` before calling `next()`. The traversal will recurse into the replacement, not the original.

```js
const templates = {
  greeting:  { text: 'Hello!', style: 'bold' },
  separator: { text: '---',    style: 'plain' },
};

traverse(data, function (node, next) {
  if (node?.type === 'template') {
    this.parent[this.key] = templates[node.name] ?? { text: '', style: 'plain' };
  }
  next(); // recurses into the replacement if one was assigned
});
```

This works for any replacement — objects, arrays, or primitives. If the replacement is a primitive or has no children, `next()` simply advances without recursing.

---

### Read files into a tree

Load file contents into a nested structure in one pass. Each node that has a `path` property is read from disk and its content stored alongside it.

```js
import { readFile } from 'fs/promises';
import traverse, { config } from 'traverse-async';

const tree = {
  config: { path: './config.json' },
  i18n: {
    en: { path: './locales/en.json' },
    fr: { path: './locales/fr.json' },
  },
};

await new Promise((resolve, reject) => {
  traverse(tree, async function (node, next) {
    if (node?.path) {
      node.content = JSON.parse(await readFile(node.path, 'utf8'));
    }
    next();
  }, (err, data) => err ? reject(err) : resolve(data));
});

// tree.config.content, tree.i18n.en.content, etc. are now populated
```

Run the file reads in parallel by setting `config({ parallel: 4 })` before traversal.

### Hydrate database references

An API response contains `{ $ref: 'users/42' }` nodes scattered at arbitrary depths. Replace each one with the real record in place and let `next()` recurse into it.

```js
traverse(document, async function (node, next) {
  if (node?.$ref) {
    this.parent[this.key] = await db.get(node.$ref);
  }
  next();
}, (err) => { if (!err) render(document); });
```

### Check all URLs in a document

Walk any structure that may contain URL strings at arbitrary depth and verify each one responds successfully.

```js
const broken = [];

await new Promise((resolve, reject) => {
  traverse(document, async function (node, next) {
    if (typeof node === 'string' && node.startsWith('https://')) {
      const res = await fetch(node, { method: 'HEAD' });
      if (!res.ok) broken.push({ url: node, status: res.status, path: this.path.join('.') });
    }
    next();
  }, (err) => err ? reject(err) : resolve());
});

console.log('broken links:', broken);
```

### Process nodes in parallel

When each node's work is independent, raise the concurrency limit so multiple nodes run at the same time.

```js
import traverse, { config } from 'traverse-async';

config({ parallel: 5 });

await new Promise((resolve, reject) => {
  traverse(assetTree, async function (node, next) {
    if (node?.type === 'image') {
      const res = await fetch(node.src);
      const buf = await res.arrayBuffer();
      node.size = buf.byteLength;
    }
    next();
  }, (err, data) => err ? reject(err) : resolve(data));
});
```

### Build a flat map of all leaf paths

Reduce a nested object to a plain `{ 'a.b.c': value }` map — useful for diffing, serialising form state, or generating dot-notation keys.

```js
const flat = {};

traverse({ a: { b: 1 }, c: [2, 3] }, function (node, next) {
  if (typeof node !== 'object' || node === null) {
    flat[this.path.join('.')] = node;
  }
  next();
}, () => {
  console.log(flat);
  // { 'a.b': 1, 'c.0': 2, 'c.1': 3 }
});
```

### Find the first matching node

Search a deep tree and bail out the moment a match is found, without visiting the rest.

```js
let found = null;

const queue = traverse(tree, function (node, next) {
  if (node?.id === 'abc123') {
    found = node;
    queue.break();
    return;
  }
  next();
}, () => console.log('not found'));

// found is set as soon as the match is hit
```

### Resolve nested promises

Walk a structure that may contain promises at arbitrary locations and await each one in place.

```js
await new Promise((resolve, reject) => {
  traverse(data, async function (node, next) {
    if (node != null && typeof node.then === 'function') {
      this.parent[this.key] = await node;
    }
    next();
  }, (err, data) => err ? reject(err) : resolve(data));
});

console.log('all promises resolved', data);
```

### Delete nodes

Remove keys from an object while traversing — for example, stripping all `null` values.

```js
traverse(obj, function (node, next) {
  if (node === null) delete this.parent[this.key];
  next();
});
```

### Non-destructive traversal

`traverse-async` operates directly on the object you pass in. This is intentional — it means:

- No extra allocation per node
- Works with any value, including class instances, functions, and DOM nodes that deep-clone utilities can't handle
- You can choose exactly what gets copied and what doesn't

When you do need to preserve the original, clone it first with a library like [klona](https://github.com/lukeed/klona) and traverse the copy:

```js
import traverse from 'traverse-async';
import { klona } from 'klona';

const result = klona(original);

traverse(result, function (node, next) {
  if (typeof node === 'string') {
    this.parent[this.key] = node.toUpperCase();
  }
  next();
}, () => {
  // original is untouched, result is transformed
  console.log(original); // { name: 'alice', address: { city: 'london' } }
  console.log(result);   // { name: 'ALICE', address: { city: 'LONDON' } }
});
```

`klona` handles plain objects, arrays, `Date`, `RegExp`, `Map`, `Set`, and typed arrays, and copies functions and class instances by reference rather than throwing. For plain JSON-like data, the built-in `structuredClone` works without any dependency.

---

## Importing

The package is a CommonJS module. It works with `require`, ESM `import`, and dynamic `import()`.

```js
// CJS
const traverse = require('traverse-async');
const { config } = require('traverse-async');

// ESM — default import
import traverse from 'traverse-async';

// ESM — named import
import { config } from 'traverse-async';

// ESM — combined
import traverse, { config } from 'traverse-async';

// ESM — dynamic
const { default: traverse, config } = await import('traverse-async');
```

---

## License

[Unlicense](http://unlicense.org/) — public domain.