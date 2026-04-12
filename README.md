# traverse-async

When you have a deeply nested object like a config tree, an API response, or document model, and need to do something at every level of it, writing the recursion yourself gets tedious. It gets harder still when the work at each node is asynchronous: a database lookup, a file read, a network call.

`traverse-async` handles the recursion for you. Give it any object or array and a callback, and it walks every node from the root down. The callback receives a context object describing the current node's position in the tree. Your callback can be async — `traverse()` returns a `Promise` that resolves when every node has been visited.

## Installation

```sh
pnpm add traverse-async
# or
npm install traverse-async
```

## Usage

```js
import traverse from 'traverse-async'; // ESM
const traverse = require('traverse-async'); // CJS
```

### Basic walk

```js
const data = { a: { b: { c: 1 } }, d: 2 };

await traverse(data, ({ node, path }) => {
  console.log(path.join('.') || '(root)', '->', node);
});
// (root) -> { a: { b: { c: 1 } }, d: 2 }
// a      -> { b: { c: 1 } }
// d      -> 2
// a.b    -> { c: 1 }
// a.b.c  -> 1
```

### Knowing when traversal is complete

`traverse()` returns a `Promise` that resolves with the original data once all nodes have been visited. Use `await` to know when it's done:

```js
const result = await traverse(data, ({ node, key }) => {
  // visit every node
});

// execution continues here once all nodes have been visited
console.log(result === data); // true — resolves with the original value
```

### Async callback

The callback can be `async`. `traverse()` awaits each callback's returned `Promise` before processing that node's children:

```js
await traverse(data, async ({ node }) => {
  if (node?.url) {
    node.data = await fetch(node.url).then(r => r.json());
  }
});
```

#### Error handling

If the callback throws synchronously, or returns a Promise that rejects, the traversal is aborted and the `traverse()` Promise rejects with that error. No further nodes are visited.

```js
try {
  await traverse(data, async ({ node }) => {
    const res = await fetch(node.url); // may throw
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    node.data = await res.json();
  });
} catch (err) {
  console.error('traversal failed:', err);
}
```

### Replacing a node by return value

Returning a non-`undefined` value from the callback replaces that node in the tree. The traversal then recurses into the replacement (unless `skip()` is also called).

```js
const obj = { a: 1, b: 2 };

await traverse(obj, ({ node, key }) => {
  if (key) return node * 10;
});

console.log(obj); // { a: 10, b: 20 }
```

This is shorthand for assigning to `parent[key]` directly. Both are equivalent:

```js
// explicit
({ node, key, parent }) => { if (key) parent[key] = node * 10; }

// via return value
({ node, key })         => { if (key) return node * 10; }
```

Returning `undefined` (or not returning) leaves the node unchanged. This means replacing a node with `undefined` isn't possible via return value — use `parent[key] = undefined` directly for that case.

Return values for the root node are ignored since there is no parent to assign into.

For an immutable workflow, clone the data first and traverse the copy:

```js
const result = await traverse(structuredClone(data), ({ node, key }) => {
  if (typeof node === 'string') return node.toUpperCase();
});
// data is unchanged, result is transformed
```

### Skipping a subtree with `skip()`

Call `skip()` from the context to visit the current node but skip all of its descendants. The rest of the traversal carries on normally.

```js
await traverse({ a: { b: { c: 1 } }, d: 2 }, ({ path, key, skip }) => {
  console.log(path.join('.') || '(root)');
  if (key === 'a') skip(); // skip everything inside a
});
// (root)
// a        ← visited, but b and c are never reached
// d
```

Use `return skip()` to exit the callback early at the same time:

```js
await traverse(data, ({ key, skip }) => {
  if (key === '_private') return skip();
  // … handle everything else
});
```

### Stopping traversal early with `stop()`

Call `stop()` to resolve the `traverse()` Promise immediately. No further nodes are visited.

```js
let found = null;

await traverse(tree, ({ node, key, stop }) => {
  if (key === 'targetId' && node === 'abc123') {
    found = node;
    return stop(); // stop immediately, Promise resolves
  }
});

console.log(found); // 'abc123', or null if not found
```

`stop()` resolves the Promise (intentional early exit). To cancel from outside the traversal and have the Promise **reject**, use an `AbortController` instead — see [Aborting from outside](#aborting-from-outside).

## API

### `traverse(data, callback, [options])` → `Promise<data>`

Walks every node in `data` breadth-first, calling `callback` once per node.

| Parameter           | Type              | Description                                                                                                                                                      |
| ------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data`              | any               | The root value to traverse. Objects and arrays are recursed into; primitives are visited as leaves.                                                              |
| `callback(context)` | function          | Called for each node. Receives a [context object](#context). May be `async`. Call `skip()` to prune children, `stop()` to halt traversal, or do nothing to recurse. |
| `options`           | object (optional) | `{ parallel, signal }` — see below.                                                                                                                              |

**Returns** a `Promise` that resolves with `data` once every node has been visited, or rejects if the callback throws or an abort signal fires.

---

### Context

The single argument passed to `callback` is a plain object describing the current node.

#### `node`

The current value being visited.

```js
await traverse({ a: 1 }, ({ node }) => {
  console.log(node); // { a: 1 }, then 1
});
```

#### `key`

The string key or array index under which this node lives in its parent. `undefined` for the root.

```js
// data = { users: [{ name: 'alice' }] }
// visiting 'alice':  key === 'name'
// visiting the array: key === 'users'
// visiting the root:  key === undefined
```

#### `parent`

The object or array that contains this node. `undefined` for the root.

```js
// Delete the current node from its parent
await traverse(obj, ({ key, parent }) => {
  if (key === 'secret') delete parent[key];
});
```

#### `path`

Array of keys from the root down to the current node. Empty array `[]` for the root.

```js
// data = { a: { b: { c: 1 } } }
// visiting c:    path === ['a', 'b', 'c']
// visiting b:    path === ['a', 'b']
// visiting root: path === []

await traverse(data, ({ node, path }) => {
  console.log(path.join('.')); // 'a', 'a.b', 'a.b.c', …
});
```

#### `isRoot`

`true` only for the root node. Useful for skipping it in callbacks that only care about children.

```js
await traverse(data, ({ node, isRoot }) => {
  if (isRoot) return; // skip the root itself
  console.log(node);
});
```

#### `skip`

Call `skip()` to visit this node but skip all of its children. The traversal continues with siblings and the rest of the tree.

```js
await traverse(data, ({ key, skip }) => {
  if (key === '_private') return skip(); // prune this subtree
});
```

Calling `skip()` does not stop the callback — code after the call still runs. Use `return skip()` to exit early.

#### `stop`

Call `stop()` to halt traversal immediately. The `traverse()` Promise resolves with the original data.

```js
let found = null;
await traverse(data, ({ node, stop }) => {
  if (node?.id === target) { found = node; return stop(); }
});
```

Unlike an `AbortController` abort, `stop()` **resolves** the Promise rather than rejecting it.

#### `push`

Injects an additional node into the traversal queue. The injected node and its children are traversed normally.

```js
await traverse(data, ({ node, path, push }) => {
  if (node?.type === 'ref') {
    push({ node: resolveRef(node), path: [...path, 'resolved'], parent: node });
  }
});
```

---

### Options

Pass an options object as the third argument to `traverse()`.

#### `parallel`

Number of nodes processed concurrently. Defaults to `1` (serial).

```js
await traverse(assetTree, async ({ node }) => {
  if (node?.type === 'image') {
    node.data = await fetchImage(node.src);
  }
}, { parallel: 4 });
```

Each `traverse()` call uses its own concurrency setting — there is no global state.

**Parallel caveats:**

- **`context.node` is a snapshot.** Each node's value is captured when it is added to the queue. If a concurrent sibling mutates the same parent key, `context.node` will be stale — use `parent[key]` to read the live value.

- **Last write wins.** With `parallel > 1`, two sibling callbacks may both produce a return value or mutate the same key. The one whose `finish()` runs last sets the final value. Avoid cross-sibling mutations when using parallelism.

- **Children come from the replacement.** If a callback returns a new object, the traversal recurses into that replacement — not the original node. Siblings running concurrently are not affected since their children haven't been queued yet.

- **`stop()` drops in-flight return values.** Once traversal is halted, any sibling callbacks still running to completion will have their return values silently discarded.

#### `signal`

An `AbortSignal` for cancelling the traversal from outside. The `traverse()` Promise rejects with an `AbortError` when the signal fires.

```js
const controller = new AbortController();

setTimeout(() => controller.abort(), 5000); // cancel after 5s

try {
  await traverse(data, async ({ node }) => { /* … */ }, { signal: controller.signal });
} catch (err) {
  if (err.name === 'AbortError') console.log('traversal was cancelled');
  else throw err;
}
```

`AbortSignal.timeout(ms)` works too:

```js
await traverse(data, handler, { signal: AbortSignal.timeout(5000) });
```

---

### Aborting from outside

Use an `AbortController` when you need to cancel traversal from code outside the callback (a timeout, a user action, a race with another Promise). The `traverse()` Promise **rejects** with an `AbortError`.

```js
const controller = new AbortController();

const p = traverse(data, handler, { signal: controller.signal });

// somewhere else:
controller.abort();

await p; // throws AbortError
```

---

## Traversal behaviour

- **Order**: breadth-first (BFS). All children of the current depth are queued before descending.
- **Objects and arrays** are recursed into. Their keys/indices are visited as child nodes.
- **Primitives** (`string`, `number`, `boolean`, `null`, `undefined`) are visited as leaves with no children.
- **Promises** (any object with a `.then` method) are visited as leaves — their internals are not traversed.
- **Only own enumerable string keys** are visited. Inherited, non-enumerable, and symbol-keyed properties are skipped.
- **Sparse array holes** are skipped (`[1,,3]` visits indices `0` and `2` only).
- **Class instances** are recursed into (own enumerable properties only).
- **Date, RegExp, Map, Set** are treated as leaves and not recursed into.
- **Circular references** are detected via a per-traversal `WeakSet`. A node whose object reference has already been recursed into is visited (the callback fires) but its children are not queued again, preventing infinite loops.
- **Shared references** (same object reachable via multiple keys) follow the same rule: the callback fires once per key, but children are only queued the first time the object is encountered.
- **Mutation**: assigning to `parent[key]` before the callback returns causes the traversal to recurse into the new value instead of the original.
- **Concurrency**: default is serial (`parallel: 1`). Pass `{ parallel: N }` to `traverse()` to process up to N nodes at once.

---

## Examples

### Skip arrays

Call `skip()` when the node is an array to prevent the traversal from descending into it. Useful when arrays contain homogeneous data you want to treat as a unit rather than walk element by element.

```js
await traverse(data, ({ node, skip }) => {
  if (Array.isArray(node)) return skip();
  // only object nodes and primitives reach here
});
```

To process the array itself but skip its contents conditionally:

```js
await traverse(data, ({ node, key, skip }) => {
  if (Array.isArray(node) && node.length > 100) {
    console.log(`skipping large array at ${key} (${node.length} items)`);
    return skip();
  }
});
```

### Act on keys matching a pattern

Check `key` against a string, set, or regex to target only the nodes you care about and ignore the rest.

```js
await traverse(config, ({ key, node, parent }) => {
  if (/_url$/i.test(key)) {
    parent[key] = node.replace('http://', 'https://');
  }
});
```

### Redact sensitive fields before logging

Strip passwords, tokens, and secrets from a payload at any nesting depth before it reaches a logger or external service.

```js
const SENSITIVE = new Set(['password', 'token', 'secret', 'apiKey']);

await traverse(payload, ({ key, parent, skip }) => {
  if (SENSITIVE.has(key)) {
    parent[key] = '[redacted]';
    return skip(); // no need to recurse into the redacted value
  }
});

logger.info(payload);
```

### Interpolate environment variables in a config object

Walk a loaded config and replace `${VAR}` placeholders with real values before the app starts.

```js
const ENV_PLACEHOLDER = /\$\{([^}]+)\}/g;

await traverse(config, ({ node }) => {
  if (typeof node === 'string') {
    return node.replace(ENV_PLACEHOLDER, (_, name) => process.env[name] ?? '');
  }
});

startApp(config);
```

### Replace a node and traverse the replacement

Assign a new value to `parent[key]` before the callback returns. The traversal will recurse into the replacement, not the original.

```js
const templates = {
  greeting:  { text: 'Hello!', style: 'bold' },
  separator: { text: '---',    style: 'plain' },
};

await traverse(data, ({ node, key, parent }) => {
  if (node?.type === 'template') {
    parent[key] = templates[node.name] ?? { text: '', style: 'plain' };
    // traversal will recurse into the replacement
  }
});
```

This works for any replacement — objects, arrays, or primitives. If the replacement is a primitive or has no children, the traversal simply advances without recursing.

### Read files into a tree

Load file contents into a nested structure in one pass.

```js
import { readFile } from 'fs/promises';
import traverse from 'traverse-async';

const tree = {
  config: { path: './config.json' },
  i18n: {
    en: { path: './locales/en.json' },
    fr: { path: './locales/fr.json' },
  },
};

await traverse(tree, async ({ node }) => {
  if (node?.path) {
    node.content = JSON.parse(await readFile(node.path, 'utf8'));
  }
}, { parallel: 4 });

// tree.config.content, tree.i18n.en.content, etc. are now populated
```

### Hydrate database references

An API response contains `{ $ref: 'users/42' }` nodes scattered at arbitrary depths. Replace each one with the real record in place.

```js
await traverse(document, async ({ node }) => {
  if (node?.$ref) {
    return await db.get(node.$ref); // replaces the $ref node; traversal recurses into the result
  }
});

render(document);
```

### Check all URLs in a document

Walk any structure that may contain URL strings at arbitrary depth and verify each one responds successfully.

```js
const broken = [];

await traverse(document, async ({ node, path }) => {
  if (typeof node === 'string' && node.startsWith('https://')) {
    const res = await fetch(node, { method: 'HEAD' });
    if (!res.ok) broken.push({ url: node, status: res.status, path: path.join('.') });
  }
}, { parallel: 5 });

console.log('broken links:', broken);
```

### Build a flat map of all leaf paths

Reduce a nested object to a plain `{ 'a.b.c': value }` map — useful for diffing, serialising form state, or generating dot-notation keys.

```js
const flat = {};

await traverse({ a: { b: 1 }, c: [2, 3] }, ({ node, path }) => {
  if (typeof node !== 'object' || node === null) {
    flat[path.join('.')] = node;
  }
});

console.log(flat);
// { 'a.b': 1, 'c.0': 2, 'c.1': 3 }
```

### Resolve nested promises

Walk a structure that may contain promises at arbitrary locations and await each one in place.

```js
await traverse(data, async ({ node }) => {
  if (node != null && typeof node.then === 'function') {
    return await node; // replaces the promise with its resolved value; traversal recurses into it
  }
});

console.log('all promises resolved', data);
```

### Delete nodes

Remove keys from an object while traversing — for example, stripping all `null` values.

```js
await traverse(obj, ({ node, key, parent }) => {
  if (node === null) delete parent[key]; // return value can't express deletion, so mutate directly
});
```

### Cancel a long-running traversal

Use `AbortController` to cancel from outside the callback — for example, on a timeout or user action.

```js
const controller = new AbortController();

// Cancel if the user navigates away
window.addEventListener('beforeunload', () => controller.abort());

try {
  await traverse(largeTree, async ({ node }) => {
    await processNode(node);
  }, { signal: controller.signal });
} catch (err) {
  if (err.name === 'AbortError') console.log('cancelled');
  else throw err;
}
```

### Non-destructive traversal

`traverse-async` operates directly on the object you pass in. When you need to preserve the original, clone it first and traverse the copy:

```js
import traverse from 'traverse-async';
import { klona } from 'klona';

const result = klona(original);

await traverse(result, ({ node, key, parent }) => {
  if (typeof node === 'string') {
    parent[key] = node.toUpperCase();
  }
});

// original is untouched, result is transformed
console.log(original); // { name: 'alice', address: { city: 'london' } }
console.log(result);   // { name: 'ALICE', address: { city: 'LONDON' } }
```

`klona` handles plain objects, arrays, `Date`, `RegExp`, `Map`, `Set`, and typed arrays. For plain JSON-like data, the built-in `structuredClone` works without any dependency.

---

## Importing

The package is a CommonJS module. It works with `require`, ESM `import`, and dynamic `import()`.

```js
// CJS
const traverse = require('traverse-async');

// ESM — default import
import traverse from 'traverse-async';

// ESM — dynamic
const { default: traverse } = await import('traverse-async');
```

---

## License

[Unlicense](http://unlicense.org/) — public domain.
