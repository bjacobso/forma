# HTTP API

Compiler fixture for declarative HTTP API authoring. This is intentionally kept
outside the registered product examples; the OCaml corpus uses it to keep the
canonical HTTP API IR shape golden-stable while the TypeScript runtime
translator is still pending.

```lisp
(type DebugBlobHash (Brand String))
(type DebugBlobUploadResponse {:hash DebugBlobHash :size Int})
(error DebugDatabaseNotFound {:database String} :status 404)
(error DebugBlobUploadError {:reason String} :status 400)
(error InternalError {:message String} :status 500)
(api debug-blobs
  :path-params {:database String :hash DebugBlobHash}
  (endpoint
    upload
    :method
    :post
    :path
    "/db/{database}/debug-blobs"
    :payload
    Bytes
    :query
    {:filename (Option String)}
    :success
    DebugBlobUploadResponse
    :errors
    [DebugDatabaseNotFound DebugBlobUploadError InternalError])
  (endpoint
    metadata
    :method
    :get
    :path
    "/db/{database}/debug-blobs/{hash}/metadata"
    :success
    DebugBlobUploadResponse
    :errors
    [DebugDatabaseNotFound InternalError]))
```
