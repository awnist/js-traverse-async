'use strict';

const async = require('async');

const isObj = (v) => Object.prototype.toString.call(v) === '[object Object]';
const isArr = (v) => Object.prototype.toString.call(v) === '[object Array]';

const settings = { parallel: 1 };

const config = (obj) => {
  for (const [key, val] of Object.entries(obj)) {
    settings[key] = val;
  }
};

const traverse = (data, userCallback, done) => {
  const seen = new WeakSet();
  let errored = false;

  const handleError = (err) => {
    if (errored) return;
    errored = true;
    q.kill();
    if (done) done(err);
  };

  const traverseNode = (context, qNext) => {
    const isContainer =
      (isArr(context.node) || isObj(context.node)) &&
      typeof context.node.then !== 'function';

    const next = () => {
      // Recurse into the current value of the parent slot so that plain assignment
      // (this.parent[this.key] = replacement) is picked up naturally.
      // For the root there is no parent slot, so fall back to context.node.
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
            node: effective[key],
            key,
            path: context.path.concat([key]),
          });
        }
      }
      qNext();
    };

    const stop = () => qNext();

    let result;
    try {
      result = userCallback.call(context, context.node, next, stop);
    } catch (err) {
      return handleError(err);
    }

    if (result && typeof result.then === 'function') {
      result.catch((err) => handleError(err));
    }
  };

  const q = async.queue(traverseNode, settings.parallel);
  q.drain(() => { if (!errored && done) done(null, data); });
  q.push({ node: data, path: [], isRoot: true });

  return { break: q.kill, push: q.push };
};

module.exports = traverse;
module.exports.config = config;
