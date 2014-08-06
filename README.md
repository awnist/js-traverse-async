# What is "traverse-async"?

traverse-async is a Javascript/node.js module that asynchronously and recursively walks an object tree.

# Usage

```
    var traverse = require('traverse-async');

    traverse(object, function(node, next){
        console.log("Current node", node);
        console.log("Context object", this);
        next();
    }, function(newObj) {
        console.log("Done!");
    });
```

# Context

The callback has a context (its `this` object) with these attributes:

## this.key

The name of the key of the present node in its parent.
This is `undefined` for the root node.

## this.parent

The parent of the current node.
This is `undefined` for the root node.

this.parent can be useful when deleting the current node:
```
    delete this.parent[this.key]
```

## this.path

An array of string keys from the root to the present node

# Examples

Walk an object tree, resolving promises at arbitrary, nested locations:

```
    var traverseasync = require('traverse-async');

    var promises = {};

    traverseasync.traverse(result, function(value, next) {
      var key, parent, path;
      if (isPromise(this.node)) {
        parent = this.parent;
        key = this.key;
        path = this.path.join(".");
        promises[path] = this.node.then(function(value) {
          parent[key] = value;
          delete promises[path];
          if (Object.keys(promises).length === 0) {

            // All promises have been fulfilled

          }
        }, function(err) {

            // One of the promises errored

        });
      }
      return next();
    }, function() {
      if (Object.keys(promises).length === 0) {

        // No promises were found or they are already fulfilled.

      }
    });
```

# Installation

Use [npm](http://www.npmjs.org/).

    $ npm install traverse-async

Otherwise, you can check traverse-async into your repository and expose it:

    $ git clone git://github.com/awnist/js-traverse-async.git node_modules/traverse-async/

traverse-async is [UNLICENSED](http://unlicense.org/).
