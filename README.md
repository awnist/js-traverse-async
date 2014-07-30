# What is "traverse-async"?

traverse-async is a Javascript/node.js module that recursively walks an object tree.

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

## Installation

Use [npm](http://www.npmjs.org/).

    $ npm install traverse-async

Otherwise, you can check traverse-async into your repository and expose it:

    $ git clone git://github.com/awnist/traverse-async.git node_modules/traverse-async/

traverse-async is [UNLICENSED](http://unlicense.org/).
