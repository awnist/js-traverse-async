'use strict';

const async = require('async');

const isObj = (v) => Object.prototype.toString.call(v) === '[object Object]';
const isArr = (v) => Object.prototype.toString.call(v) === '[object Array]';

const traverse = (data, userCallback, options = {}) => {
  const signal   = options.signal   ?? null;
  const parallel = options.parallel ?? 1;

  return new Promise((resolve, reject) => {
    const seen = new WeakSet();
    let settled = false;
    let q;

    const settle = (err) => {
      if (settled) return;
      settled = true;
      if (q) q.kill();
      if (signal) signal.removeEventListener('abort', handleAbort);
      if (err) reject(err);
      else resolve(data);
    };

    const handleAbort = () => {
      settle(new DOMException('Traversal aborted', 'AbortError'));
    };

    if (signal) {
      if (signal.aborted) return handleAbort();
      signal.addEventListener('abort', handleAbort, { once: true });
    }

    const pushChildren = (context) => {
      const effective = context.key !== undefined
        ? context.parent[context.key]
        : context.node;

      const effectiveIsContainer =
        (isArr(effective) || isObj(effective)) &&
        typeof effective.then !== 'function';

      if (effectiveIsContainer && !seen.has(effective)) {
        seen.add(effective);
        for (const key of Object.keys(effective)) {
          q.push({
            parent: effective,
            node:   effective[key],
            key,
            path:   context.path.concat([key]),
          });
        }
      }
    };

    const traverseNode = (context, qNext) => {
      let skipChildren = false;
      let stopped = false;

      context.skip = () => { skipChildren = true; };
      context.stop = () => { stopped = true; };
      context.push = (item) => q.push(item);

      let result;
      try {
        result = userCallback(context);
      } catch (err) {
        settle(err);
        return;
      }

      const finish = (returnValue) => {
        if (settled) return;
        if (returnValue !== undefined && context.key !== undefined) {
          context.parent[context.key] = returnValue;
        }
        if (stopped) { settle(null); return; }
        if (!skipChildren) pushChildren(context);
        qNext();
      };

      if (result && typeof result.then === 'function') {
        result.then(finish, (err) => settle(err));
      } else {
        finish(result);
      }
    };

    q = async.queue(traverseNode, parallel);
    q.drain(() => settle(null));
    q.push({ node: data, path: [], isRoot: true });
  });
};

module.exports = traverse;
