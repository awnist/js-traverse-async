async = require 'async'

isObj = (obj) -> '[object Object]' == Object::toString.call(obj)

module.exports.traverse = (data, userCallback, done) ->

  traverseNode = (context, next) ->

    for key in Object.keys context.obj

      if isObj context.obj[key]
        q.push
          parent: context.obj
          obj: context.obj[key]
          key: key
          path: context.path.concat [key]
        # , (err) ->
        #   console.log "Done with", key

    userCallback.call context, context.obj, next

  q = async.queue traverseNode, 1

  q.drain = -> done(data) if done

  q.push { obj: data, path: [] }
