/*jslint indent: 2, nomen: true, maxlen: 100, sloppy: true, vars: true, white: true, plusplus: true */
/*global ArangoClusterComm, ArangoClusterInfo, require, exports */

////////////////////////////////////////////////////////////////////////////////
/// @brief ArangoCollection
///
/// @file
///
/// DISCLAIMER
///
/// Copyright 2011-2013 triagens GmbH, Cologne, Germany
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///
/// Copyright holder is triAGENS GmbH, Cologne, Germany
///
/// @author Dr. Frank Celler
/// @author Copyright 2011-2013, triAGENS GmbH, Cologne, Germany
////////////////////////////////////////////////////////////////////////////////

var internal = require("internal");

// -----------------------------------------------------------------------------
// --SECTION--                                                  ArangoCollection
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// --SECTION--                                      constructors and destructors
// -----------------------------------------------------------------------------

////////////////////////////////////////////////////////////////////////////////
/// @brief constructor
////////////////////////////////////////////////////////////////////////////////

var ArangoCollection = internal.ArangoCollection;
exports.ArangoCollection = ArangoCollection;

// must be called after exporting ArangoCollection
require("org/arangodb/arango-collection-common");

var simple = require("org/arangodb/simple-query");
var ArangoError = require("org/arangodb").ArangoError;
var ArangoDatabase = require("org/arangodb/arango-database").ArangoDatabase;

// -----------------------------------------------------------------------------
// --SECTION--                                                 private functions
// -----------------------------------------------------------------------------

////////////////////////////////////////////////////////////////////////////////
/// @brief converts collection into an array
///
/// @FUN{@FA{collection}.toArray()}
///
/// Converts the collection into an array of documents. Never use this call
/// in a production environment.
////////////////////////////////////////////////////////////////////////////////

ArangoCollection.prototype.toArray = function () {
  var cluster = require("org/arangodb/cluster");

  if (cluster.isCoordinator()) {
    return this.all().toArray();
  }

  return this.ALL(null, null).documents;
};

// -----------------------------------------------------------------------------
// --SECTION--                                                  public functions
// -----------------------------------------------------------------------------

////////////////////////////////////////////////////////////////////////////////
/// @brief truncates a collection
///
/// @FUN{@FA{collection}.truncate()}
///
/// Truncates a @FA{collection}, removing all documents but keeping all its
/// indexes.
///
/// @EXAMPLES
///
/// Truncates a collection:
///
/// @code
/// arango> col = db.examples;
/// [ArangoCollection 91022, "examples" (status new born)]
/// arango> col.save({ "Hello" : "World" });
/// { "_id" : "91022/1532814", "_rev" : 1532814 }
/// arango> col.count();
/// 1
/// arango> col.truncate();
/// arango> col.count();
/// 0
/// @endcode
////////////////////////////////////////////////////////////////////////////////

ArangoCollection.prototype.truncate = function () {
  var cluster = require("org/arangodb/cluster");

  if (cluster.isCoordinator()) {
    var dbName = require("internal").db._name();
    var shards = cluster.shardList(dbName, this.name());
    var coord = { coordTransactionID: ArangoClusterInfo.uniqid() };
    var options = { coordTransactionID: coord.coordTransactionID, timeout: 360 };
      
    shards.forEach(function (shard) {
      ArangoClusterComm.asyncRequest("put", 
                                     "shard:" + shard, 
                                     dbName, 
                                     "/_api/collection/" + encodeURIComponent(shard) + "/truncate",
                                     "", 
                                     { }, 
                                     options);
    });

    cluster.wait(coord, shards);
    return;
  }

  return this.TRUNCATE();
};

// -----------------------------------------------------------------------------
// --SECTION--                                                   index functions
// -----------------------------------------------------------------------------

////////////////////////////////////////////////////////////////////////////////
/// @brief finds an index of a collection
///
/// @FUN{@FA{collection}.index(@FA{index-handle})}
///
/// Returns the index with @FA{index-handle} or null if no such index exists.
///
/// @EXAMPLES
///
/// @code
/// arango> db.example.getIndexes().map(function(x) { return x.id; });
/// ["93013/0"]
/// arango> db.example.index("93013/0");
/// { "id" : "93013/0", "type" : "primary", "fields" : ["_id"] }
/// @endcode
////////////////////////////////////////////////////////////////////////////////

ArangoCollection.prototype.index = function (id) {
  var indexes = this.getIndexes();
  var i;

  if (typeof id === "string") {
    var pa = ArangoDatabase.indexRegex.exec(id);

    if (pa === null) {
      id = this.name() + "/" + id;
    }
  }
  else if (id && id.hasOwnProperty("id")) {
    id = id.id;
  }
  else if (typeof id === "number") {
    // stringify the id
    id = this.name() + "/" + id;
  }

  for (i = 0;  i < indexes.length;  ++i) {
    var index = indexes[i];

    if (index.id === id) {
      return index;
    }
  }

  // index not found
  var err = new ArangoError();
  err.errorNum = internal.errors.ERROR_ARANGO_INDEX_NOT_FOUND.code;
  err.errorMessage = internal.errors.ERROR_ARANGO_INDEX_NOT_FOUND.message;

  throw err;
};

// -----------------------------------------------------------------------------
// --SECTION--                                                document functions
// -----------------------------------------------------------------------------

////////////////////////////////////////////////////////////////////////////////
/// @brief returns any document from a collection
///
/// @FUN{@FA{collection}.any()}
///
/// Returns a random document from the collection or @LIT{null} if none exists.
///
////////////////////////////////////////////////////////////////////////////////

ArangoCollection.prototype.any = function () {
  var cluster = require("org/arangodb/cluster");

  if (cluster.isCoordinator()) {
    var dbName = require("internal").db._name();
    var shards = cluster.shardList(dbName, this.name());
    var coord = { coordTransactionID: ArangoClusterInfo.uniqid() };
    var options = { coordTransactionID: coord.coordTransactionID, timeout: 360 };
      
    shards.forEach(function (shard) {
      ArangoClusterComm.asyncRequest("put", 
                                     "shard:" + shard, 
                                     dbName, 
                                     "/_api/simple/any", 
                                     JSON.stringify({ 
                                       collection: shard 
                                     }), 
                                     { }, 
                                     options);
    });

    var results = cluster.wait(coord, shards), i;
    for (i = 0; i < results.length; ++i) {
      var body = JSON.parse(results[i].body);
      if (body.document !== null) {
        return body.document;
      }
    }

    return null;
  }

  return this.ANY();
};

////////////////////////////////////////////////////////////////////////////////
/// @fn JSF_ArangoCollection_prototype_first
///
/// @brief selects the n first documents in the collection
///
/// @FUN{@FA{collection}.first(@FA{count})}
///
/// The @FN{first} method returns the n first documents from the collection, in 
/// order of document insertion/update time. 
///
/// If called with the @FA{count} argument, the result is a list of up to
/// @FA{count} documents. If @FA{count} is bigger than the number of documents
/// in the collection, then the result will contain as many documents as there
/// are in the collection.
/// The result list is ordered, with the "oldest" documents being positioned at 
/// the beginning of the result list.
///
/// When called without an argument, the result is the first document from the
/// collection. If the collection does not contain any documents, the result 
/// returned is @LIT{null}.
///
/// Note: this method is not supported on sharded collections with more than
/// one shard.
///
/// @EXAMPLES
///
/// @code
/// arangod> db.example.first(1)
/// [ { "_id" : "example/222716379559", "_rev" : "222716379559", "Hello" : "World" } ]
/// @endcode
///
/// @code
/// arangod> db.example.first()
/// { "_id" : "example/222716379559", "_rev" : "222716379559", "Hello" : "World" }
/// @endcode
////////////////////////////////////////////////////////////////////////////////

ArangoCollection.prototype.first = function (count) {
  var cluster = require("org/arangodb/cluster");

  if (cluster.isCoordinator()) {
    var dbName = require("internal").db._name();
    var shards = cluster.shardList(dbName, this.name());

    if (shards.length !== 1) {
      var err = new ArangoError();
      err.errorNum = internal.errors.ERROR_NOT_IMPLEMENTED.code;
      err.errorMessage = "operation is not supported in clustered collections with multiple shards";

      throw err;
    }

    var coord = { coordTransactionID: ArangoClusterInfo.uniqid() };
    var options = { coordTransactionID: coord.coordTransactionID, timeout: 360 };
    var shard = shards[0];

    ArangoClusterComm.asyncRequest("put", 
                                   "shard:" + shard, 
                                   dbName, 
                                   "/_api/simple/first", 
                                   JSON.stringify({ 
                                     collection: shard,
                                     count: count 
                                   }), 
                                   { }, 
                                   options);

    var results = cluster.wait(coord, shards), i;

    if (results.length) {
      var body = JSON.parse(results[i].body);
      return body.result || null;
    }
  }
  else {
    return this.FIRST(count);
  } 

  return null;
};

////////////////////////////////////////////////////////////////////////////////
/// @fn JSF_ArangoCollection_prototype_last
///
/// @brief selects the n last documents in the collection
///
/// @FUN{@FA{collection}.last(@FA{count})}
///
/// The @FN{last} method returns the n last documents from the collection, in 
/// order of document insertion/update time. 
///
/// If called with the @FA{count} argument, the result is a list of up to
/// @FA{count} documents. If @FA{count} is bigger than the number of documents
/// in the collection, then the result will contain as many documents as there
/// are in the collection.
/// The result list is ordered, with the "latest" documents being positioned at 
/// the beginning of the result list.
///
/// When called without an argument, the result is the last document from the
/// collection. If the collection does not contain any documents, the result 
/// returned is @LIT{null}.
///
/// Note: this method is not supported on sharded collections with more than
/// one shard.
///
/// @EXAMPLES
///
/// @code
/// arangod> db.example.last(1)
/// [ { "_id" : "example/222716379559", "_rev" : "222716379559", "Hello" : "World" } ]
/// @endcode
///
/// @code
/// arangod> db.example.last()
/// { "_id" : "example/222716379559", "_rev" : "222716379559", "Hello" : "World" }
/// @endcode
////////////////////////////////////////////////////////////////////////////////

ArangoCollection.prototype.last = function (count) {
  var cluster = require("org/arangodb/cluster");

  if (cluster.isCoordinator()) {
    var dbName = require("internal").db._name();
    var shards = cluster.shardList(dbName, this.name());

    if (shards.length !== 1) {
      var err = new ArangoError();
      err.errorNum = internal.errors.ERROR_NOT_IMPLEMENTED.code;
      err.errorMessage = "operation is not supported in clustered collections with multiple shards";

      throw err;
    }

    var coord = { coordTransactionID: ArangoClusterInfo.uniqid() };
    var options = { coordTransactionID: coord.coordTransactionID, timeout: 360 };
    var shard = shards[0];

    ArangoClusterComm.asyncRequest("put", 
                                   "shard:" + shard, 
                                   dbName, 
                                   "/_api/simple/last", 
                                   JSON.stringify({ 
                                     collection: shard,
                                     count: count 
                                   }), 
                                   { }, 
                                   options);

    var results = cluster.wait(coord, shards), i;

    if (results.length) {
      var body = JSON.parse(results[i].body);
      return body.result || null;
    }
  }
  else {
    return this.LAST(count);
  }

  return null; 
};

////////////////////////////////////////////////////////////////////////////////
/// @fn JSF_ArangoCollection_prototype_firstExample
///
/// @brief constructs a query-by-example for a collection
///
/// @FUN{@FA{collection}.firstExample(@FA{example})}
///
/// Returns the first document of a collection that matches the specified 
/// example or @LIT{null}. The example must be specified as paths and values. 
/// See @FN{byExample} for details.
///
/// @FUN{@FA{collection}.firstExample(@FA{path1}, @FA{value1}, ...)}
///
/// As alternative you can supply a list of paths and values.
///
/// @EXAMPLES
///
/// @TINYEXAMPLE{shell-simple-query-first-example,finds a document with a given name}
////////////////////////////////////////////////////////////////////////////////

ArangoCollection.prototype.firstExample = function (example) {
  var e;
  var i;

  // example is given as only argument
  if (arguments.length === 1) {
    e = example;
  }

  // example is given as list
  else {
    e = {};

    for (i = 0;  i < arguments.length;  i += 2) {
      e[arguments[i]] = arguments[i + 1];
    }
  }

  var documents = (new simple.SimpleQueryByExample(this, e)).limit(1).toArray();
  if (documents.length > 0) {
    return documents[0];
  }

  return null;
};

////////////////////////////////////////////////////////////////////////////////
/// @brief removes documents matching an example
////////////////////////////////////////////////////////////////////////////////

ArangoCollection.prototype.removeByExample = function (example, 
                                                       waitForSync, 
                                                       limit) {
  if (limit === 0) {
    return 0;
  }

  var deleted = 0;
  var documents;
  var cluster = require("org/arangodb/cluster");

  if (cluster.isCoordinator()) {
    if (limit > 0) {
      var err = new ArangoError();
      err.errorNum = internal.errors.ERROR_NOT_IMPLEMENTED.code;
      err.errorMessage = "limit not supported in clustered operation";

      throw err;
    }

    var dbName = require("internal").db._name();
    var shards = cluster.shardList(dbName, this.name());
    var coord = { coordTransactionID: ArangoClusterInfo.uniqid() };
    var options = { coordTransactionID: coord.coordTransactionID, timeout: 360 };
      
    shards.forEach(function (shard) {
      ArangoClusterComm.asyncRequest("put", 
                                     "shard:" + shard, 
                                     dbName, 
                                     "/_api/simple/remove-by-example", 
                                     JSON.stringify({ 
                                       collection: shard,
                                       example: example,
                                       waitForSync: waitForSync
                                     }), 
                                     { }, 
                                     options);
    });

    var results = cluster.wait(coord, shards), i;
    for (i = 0; i < results.length; ++i) {
      var body = JSON.parse(results[i].body);

      deleted += (body.deleted || 0);
    }
  }
  else {
    documents = this.byExample(example);
    if (limit > 0) {
      documents = documents.limit(limit);
    }

    while (documents.hasNext()) {
      var document = documents.next();
 
      if (this.remove(document, true, waitForSync)) {
        deleted++;
      }
    }
  }

  return deleted;
};

////////////////////////////////////////////////////////////////////////////////
/// @brief replaces documents matching an example
////////////////////////////////////////////////////////////////////////////////

ArangoCollection.prototype.replaceByExample = function (example, 
                                                        newValue, 
                                                        waitForSync, 
                                                        limit) {
  if (limit === 0) {
    return 0;
  }

  if (typeof newValue !== "object" || Array.isArray(newValue)) {
    var err1 = new ArangoError();
    err1.errorNum = internal.errors.ERROR_BAD_PARAMETER.code;
    err1.errorMessage = "invalid value for parameter 'newValue'";

    throw err1;
  }

  var replaced = 0;
  var documents;
  var cluster = require("org/arangodb/cluster");

  if (cluster.isCoordinator()) {
    if (limit > 0) {
      var err2 = new ArangoError();
      err2.errorNum = internal.errors.ERROR_NOT_IMPLEMENTED.code;
      err2.errorMessage = "limit not supported in clustered operation";

      throw err2;
    }

    var dbName = require("internal").db._name();
    var shards = cluster.shardList(dbName, this.name());
    var coord = { coordTransactionID: ArangoClusterInfo.uniqid() };
    var options = { coordTransactionID: coord.coordTransactionID, timeout: 360 };
      
    shards.forEach(function (shard) {
      ArangoClusterComm.asyncRequest("put", 
                                     "shard:" + shard, 
                                     dbName, 
                                     "/_api/simple/replace-by-example", 
                                     JSON.stringify({ 
                                       collection: shard,
                                       example: example,
                                       newValue: newValue,
                                       waitForSync: waitForSync
                                     }), 
                                     { }, 
                                     options);
    });

    var results = cluster.wait(coord, shards), i;
    for (i = 0; i < results.length; ++i) {
      var body = JSON.parse(results[i].body);

      replaced += (body.replaced || 0);
    }
  }
  else {
    documents = this.byExample(example);
    if (limit > 0) {
      documents = documents.limit(limit);
    }

    while (documents.hasNext()) {
      var document = documents.next();

      if (this.replace(document, newValue, true, waitForSync)) {
        replaced++;
      }
    }
  }

  return replaced;
};

////////////////////////////////////////////////////////////////////////////////
/// @brief partially updates documents matching an example
////////////////////////////////////////////////////////////////////////////////

ArangoCollection.prototype.updateByExample = function (example, 
                                                       newValue, 
                                                       keepNull, 
                                                       waitForSync, 
                                                       limit) {
  
  if (limit === 0) {
    return 0;
  }
  
  if (typeof newValue !== "object" || Array.isArray(newValue)) {
    var err1 = new ArangoError();
    err1.errorNum = internal.errors.ERROR_BAD_PARAMETER.code;
    err1.errorMessage = "invalid value for parameter 'newValue'";

    throw err1;
  }
  
  var updated = 0;
  var documents;
  var cluster = require("org/arangodb/cluster");

  if (cluster.isCoordinator()) {
    if (limit > 0) {
      var err2 = new ArangoError();
      err2.errorNum = internal.errors.ERROR_NOT_IMPLEMENTED.code;
      err2.errorMessage = "limit not supported in clustered operation";

      throw err2;
    }

    var dbName = require("internal").db._name();
    var shards = cluster.shardList(dbName, this.name());
    var coord = { coordTransactionID: ArangoClusterInfo.uniqid() };
    var options = { coordTransactionID: coord.coordTransactionID, timeout: 360 };
      
    shards.forEach(function (shard) {
      ArangoClusterComm.asyncRequest("put", 
                                     "shard:" + shard, 
                                     dbName, 
                                     "/_api/simple/update-by-example", 
                                     JSON.stringify({ 
                                       collection: shard,
                                       example: example,
                                       newValue: newValue,
                                       waitForSync: waitForSync,
                                       keepNull: keepNull
                                     }), 
                                     { }, 
                                     options);
    });

    var results = cluster.wait(coord, shards), i;
    for (i = 0; i < results.length; ++i) {
      var body = JSON.parse(results[i].body);

      updated += (body.updated || 0);
    }
  }
  else {
    documents = this.byExample(example);
    if (limit > 0) {
      documents = documents.limit(limit);
    }

    while (documents.hasNext()) {
      var document = documents.next();
 
      if (this.update(document, newValue, true, keepNull, waitForSync)) {
        updated++;
      }
    }
  }

  return updated;
};

// -----------------------------------------------------------------------------
// --SECTION--                                                       END-OF-FILE
// -----------------------------------------------------------------------------

// Local Variables:
// mode: outline-minor
// outline-regexp: "/// @brief\\|/// @addtogroup\\|// --SECTION--\\|/// @}\\|/\\*jslint"
// End:
