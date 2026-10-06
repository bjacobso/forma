type declaration = { index : int; span : Ast.span; value : Http_ir.value }
(* Typed IR boundary guard: value : Http_ir.value; *)

let make_declaration ~index ~span ~value = { index; span; value }
let declaration_index declaration = declaration.index
let declaration_span declaration = declaration.span
let declaration_value declaration = declaration.value

module StringSet = Set.Make (String)

let declaration_span_for_path (declarations : declaration list) path =
  let prefix = "$.declarations[" in
  let prefix_len = String.length prefix in
  if String.length path <= prefix_len then None
  else if String.sub path 0 prefix_len <> prefix then None
  else
    match String.index_from_opt path prefix_len ']' with
    | None -> None
    | Some close_index -> (
        let raw_index = String.sub path prefix_len (close_index - prefix_len) in
        match int_of_string_opt raw_index with
        | None -> None
        | Some index ->
            declarations
            |> List.find_opt (fun declaration -> declaration.index = index)
            |> Option.map (fun declaration -> declaration.span))

let diagnostic_for_ref declarations ~path ~code ~message =
  let span =
    match declaration_span_for_path declarations path with
    | Some span -> span
    | None -> (
        match declarations with
        | first :: _ -> first.span
        | [] -> Cst.span "generated" 0 0)
  in
  Diagnostic.error ~path ~span ~code ~message ()

let validate_http_declaration_shapes declarations =
  declarations
  |> List.filter_map (fun declaration ->
      match
        ( Http_ir.schema_payload_of_value declaration.value,
          Http_ir.http_api_payload_of_value declaration.value )
      with
      | Some _, _ | _, Some _ -> None
      | None, None ->
          Some
            (diagnostic_for_ref declarations
               ~path:(Printf.sprintf "$.declarations[%d]" declaration.index)
               ~code:"http/invalid-declaration"
               ~message:
                 "HTTP artifact validator received a declaration that is not a \
                  Schema or HttpApi payload."))

let builtin_schema_refs =
  [ "InternalError" ]
  |> List.fold_left (fun refs name -> StringSet.add name refs) StringSet.empty

let builtin_error_refs = builtin_schema_refs

let rec collect_schema_refs ~path refs = function
  | Http_ir.Ref target -> (path, target) :: refs
  | Primitive _ | Literal _ -> refs
  | Optional item | Array item | Brand { schema = item; _ } ->
      collect_schema_refs ~path:(path ^ ".item") refs item
  | Struct fields ->
      fields
      |> List.mapi (fun index ({ Http_ir.schema; _ } : Http_ir.field) ->
          (index, schema))
      |> List.fold_left
           (fun refs (index, schema) ->
             collect_schema_refs
               ~path:(Printf.sprintf "%s.fields[%d].schema" path index)
               refs schema)
           refs
  | Union variants ->
      variants
      |> List.mapi (fun index variant -> (index, variant))
      |> List.fold_left
           (fun refs (index, variant) ->
             collect_schema_refs
               ~path:(Printf.sprintf "%s.variants[%d]" path index)
               refs variant)
           refs
  | Annotated { schema; _ } ->
      collect_schema_refs ~path:(path ^ ".schema") refs schema

let collect_endpoint_schema_refs ~path refs (endpoint : Http_ir.endpoint) =
  let refs =
    match endpoint.payload with
    | None -> refs
    | Some payload -> collect_schema_refs ~path:(path ^ ".payload") refs payload
  in
  let refs =
    match endpoint.query with
    | None -> refs
    | Some query -> collect_schema_refs ~path:(path ^ ".query") refs query
  in
  collect_schema_refs ~path:(path ^ ".success") refs endpoint.success

let collect_endpoint_error_refs ~path refs (endpoint : Http_ir.endpoint) =
  endpoint.errors
  |> List.mapi (fun index error -> (index, error))
  |> List.fold_left
       (fun refs (index, error) ->
         collect_schema_refs
           ~path:(Printf.sprintf "%s.errors[%d]" path index)
           refs error)
       refs

let validate_schema_references (declarations : declaration list) =
  let declared_schema_refs =
    declarations
    |> List.filter_map (fun declaration ->
        match Http_ir.schema_payload_of_value declaration.value with
        | Some (name, _, _) -> Some name
        | None -> None)
    |> List.fold_left
         (fun refs name -> StringSet.add name refs)
         builtin_schema_refs
  in
  declarations
  |> List.map (fun declaration ->
      let base = Printf.sprintf "$.declarations[%d]" declaration.index in
      match
        ( Http_ir.schema_payload_of_value declaration.value,
          Http_ir.http_api_payload_of_value declaration.value )
      with
      | Some (_, _, schema), _ ->
          collect_schema_refs ~path:(base ^ ".schema") [] schema
      | None, Some (_, groups) ->
          groups
          |> List.mapi (fun group_index (group : Http_ir.api_group) ->
              (group_index, group))
          |> List.fold_left
               (fun refs (group_index, group) ->
                 let group_path =
                   Printf.sprintf "%s.groups[%d]" base group_index
                 in
                 let refs =
                   group.Http_ir.path_params
                   |> List.mapi
                        (fun
                          field_index ({ Http_ir.schema; _ } : Http_ir.field) ->
                          (field_index, schema))
                   |> List.fold_left
                        (fun refs (field_index, schema) ->
                          collect_schema_refs
                            ~path:
                              (Printf.sprintf "%s.pathParams[%d].schema"
                                 group_path field_index)
                            refs schema)
                        refs
                 in
                 group.Http_ir.endpoints
                 |> List.mapi (fun endpoint_index endpoint ->
                     (endpoint_index, endpoint))
                 |> List.fold_left
                      (fun refs (endpoint_index, endpoint) ->
                        collect_endpoint_schema_refs
                          ~path:
                            (Printf.sprintf "%s.endpoints[%d]" group_path
                               endpoint_index)
                          refs endpoint)
                      refs)
               []
      | None, None -> [])
  |> List.concat |> List.rev
  |> List.filter_map (fun (path, target) ->
      if StringSet.mem target declared_schema_refs then None
      else
        Some
          (diagnostic_for_ref declarations ~path ~code:"http/unknown-schema-ref"
             ~message:
               (Printf.sprintf
                  "Unknown schema reference %S. Define it with __schema \
                   or __error before using it in an HTTP API."
                  target)))

let validate_endpoint_error_references (declarations : declaration list) =
  let declared_error_refs =
    declarations
    |> List.filter_map (fun declaration ->
        match Http_ir.schema_payload_of_value declaration.value with
        | Some (name, Some "Error", _) -> Some name
        | Some _ | None -> None)
    |> List.fold_left
         (fun refs name -> StringSet.add name refs)
         builtin_error_refs
  in
  declarations
  |> List.filter_map (fun declaration ->
      match Http_ir.http_api_payload_of_value declaration.value with
      | Some (_, groups) ->
          let base = Printf.sprintf "$.declarations[%d]" declaration.index in
          Some
            (groups
            |> List.mapi (fun group_index (group : Http_ir.api_group) ->
                (group_index, group))
            |> List.fold_left
                 (fun refs (group_index, group) ->
                   let group_path =
                     Printf.sprintf "%s.groups[%d]" base group_index
                   in
                   group.Http_ir.endpoints
                   |> List.mapi (fun endpoint_index endpoint ->
                       (endpoint_index, endpoint))
                   |> List.fold_left
                        (fun refs (endpoint_index, endpoint) ->
                          collect_endpoint_error_refs
                            ~path:
                              (Printf.sprintf "%s.endpoints[%d]" group_path
                                 endpoint_index)
                            refs endpoint)
                        refs)
                 [])
      | None -> None)
  |> List.concat |> List.rev
  |> List.filter_map (fun (path, target) ->
      if StringSet.mem target declared_error_refs then None
      else
        Some
          (diagnostic_for_ref declarations ~path ~code:"http/undeclared-error"
             ~message:
               (Printf.sprintf
                  "Endpoint error %S must be declared with __error before \
                   using it in :errors."
                  target)))

let validate_declarations declarations =
  validate_http_declaration_shapes declarations
  @ validate_schema_references declarations
  @ validate_endpoint_error_references declarations
