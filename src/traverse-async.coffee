async = require 'async'

isObj = (obj) -> '[object Object]' == Object::toString.call(obj)

config = { parallel: 1 }

module.exports.config = (obj) -> config[key] = val for key, val of obj

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

  q = async.queue traverseNode, config.parallel

  q.drain = -> done(data) if done

  q.push { obj: data, path: [] }
