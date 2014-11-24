async = require 'async'

isObj = (obj) -> '[object Object]' == Object::toString.call(obj)
isArr = (arr) -> '[object Array]' == Object::toString.call(arr)

config = { parallel: 1 }

exports.config = (obj) -> config[key] = val for key, val of obj

exports.traverse = (data, userCallback, done) ->

  traverseNode = (context, next) ->

    # is object and not promise?...
    if (isArr(context.node) or isObj(context.node)) and typeof context.node.then isnt "function"
      # ...then queue all children
      for key in Object.keys context.node
        q.push
          parent: context.node
          node: context.node[key]
          key: key
          path: context.path.concat [key]

    userCallback.call context, context.node, next

  q = async.queue traverseNode, config.parallel

  q.drain = -> done(data) if done

  q.push { node: data, path: [], isRoot: true }

  q
