type value = Value.t =
  | VNil
  | VBool of bool
  | VInt of int
  | VFloat of float
  | VString of string
  | VSymbol of string
  | VKeyword of string
  | VList of value list
  | VVector of value list
  | VMap of (value * value) list
  | VDictionary of (value * value) list
  | VClosure of closure
  | VMacro of closure

and closure = Value.closure = {
  params : string list;
  rest_param : string option;
  body : Ast.expr list;
  env : (string * value) list;
}

type field = { name : string; schema : schema }

and schema =
  | Ref of string
  | Primitive of string
  | Literal of value
  | Optional of schema
  | Array of schema
  | Struct of field list
  | Union of schema list
  | Brand of { brand : string; schema : schema }
  | Annotated of { schema : schema; annotations : (string * value) list }

type endpoint = {
  name : string;
  method_ : string;
  path : string;
  payload : schema option;
  query : schema option;
  success : schema;
  errors : schema list;
}

type api_group = {
  name : string;
  path_params : field list;
  endpoints : endpoint list;
  handlers : value list;
  annotations : (string * value) list;
}

let object_field key = function
  | VMap entries -> List.assoc_opt (VKeyword (":" ^ key)) entries
  | _ -> None

let string_field key value =
  match object_field key value with
  | Some (VString value) -> Some value
  | _ -> None

let list_field key value =
  match object_field key value with
  | Some (VList values) -> Some values
  | _ -> None

let annotations_field value =
  match object_field "annotations" value with
  | Some (VMap entries) ->
      let rec loop acc = function
        | [] -> Some (List.rev acc)
        | (VKeyword key, value) :: rest ->
            let key =
              if String.length key > 0 && key.[0] = ':' then
                String.sub key 1 (String.length key - 1)
              else key
            in
            loop ((key, value) :: acc) rest
        | _ -> None
      in
      loop [] entries
  | Some VNil -> Some []
  | None -> Some []
  | _ -> None

let rec schema_of_value = function
  | VMap _ as value -> (
      match string_field "kind" value with
      | Some "Ref" ->
          string_field "target" value |> Option.map (fun target -> Ref target)
      | Some "Primitive" ->
          string_field "prim" value |> Option.map (fun prim -> Primitive prim)
      | Some "Literal" ->
          object_field "value" value |> Option.map (fun value -> Literal value)
      | Some "Optional" ->
          Option.bind (object_field "item" value) schema_of_value
          |> Option.map (fun item -> Optional item)
      | Some "Array" ->
          Option.bind (object_field "item" value) schema_of_value
          |> Option.map (fun item -> Array item)
      | Some "Struct" ->
          Option.bind (list_field "fields" value) fields_of_values
          |> Option.map (fun fields -> Struct fields)
      | Some "Union" ->
          Option.bind (list_field "variants" value) schemas_of_values
          |> Option.map (fun variants -> Union variants)
      | Some "Brand" -> (
          match (string_field "brand" value, object_field "schema" value) with
          | Some brand, Some schema ->
              schema_of_value schema
              |> Option.map (fun schema -> Brand { brand; schema })
          | _ -> None)
      | Some "Annotated" -> (
          match (object_field "schema" value, annotations_field value) with
          | Some schema, Some annotations ->
              schema_of_value schema
              |> Option.map (fun schema -> Annotated { schema; annotations })
          | _ -> None)
      | Some _ | None -> None)
  | _ -> None

and field_of_value value =
  match (string_field "name" value, object_field "schema" value) with
  | Some name, Some schema ->
      schema_of_value schema |> Option.map (fun schema -> { name; schema })
  | _ -> None

and fields_of_values values =
  let rec loop acc = function
    | [] -> Some (List.rev acc)
    | value :: rest -> (
        match field_of_value value with
        | Some field -> loop (field :: acc) rest
        | None -> None)
  in
  loop [] values

and schemas_of_values values =
  let rec loop acc = function
    | [] -> Some (List.rev acc)
    | value :: rest -> (
        match schema_of_value value with
        | Some schema -> loop (schema :: acc) rest
        | None -> None)
  in
  loop [] values

let endpoint_of_value value =
  let optional_schema key =
    match object_field key value with
    | None | Some VNil -> Some None
    | Some schema -> schema_of_value schema |> Option.map Option.some
  in
  match
    ( string_field "name" value,
      string_field "method" value,
      string_field "path" value,
      optional_schema "payload",
      optional_schema "query",
      object_field "success" value,
      list_field "errors" value )
  with
  | ( Some name,
      Some method_,
      Some path,
      Some payload,
      Some query,
      Some success,
      Some errors ) ->
      let success = schema_of_value success in
      let errors = schemas_of_values errors in
      Option.bind success (fun success ->
          Option.map
            (fun errors ->
              { name; method_; path; payload; query; success; errors })
            errors)
  | _ -> None

let api_group_of_value value =
  match
    ( string_field "name" value,
      list_field "pathParams" value,
      list_field "endpoints" value,
      list_field "handlers" value,
      annotations_field value )
  with
  | Some name, Some path_params, Some endpoints, Some handlers, Some annotations
    ->
      let path_params = fields_of_values path_params in
      let endpoints =
        let rec loop acc = function
          | [] -> Some (List.rev acc)
          | value :: rest -> (
              match endpoint_of_value value with
              | Some endpoint -> loop (endpoint :: acc) rest
              | None -> None)
        in
        loop [] endpoints
      in
      Option.bind path_params (fun path_params ->
          Option.map
            (fun endpoints ->
              { name; path_params; endpoints; handlers; annotations })
            endpoints)
  | _ -> None

let schema_payload_of_value value =
  match (string_field "name" value, object_field "schema" value) with
  | Some name, Some schema ->
      schema_of_value schema
      |> Option.map (fun schema ->
          (name, string_field "schemaKind" value, schema))
  | _ -> None

let http_api_payload_of_value value =
  match (string_field "name" value, list_field "groups" value) with
  | Some name, Some groups ->
      let rec loop acc = function
        | [] -> Some (List.rev acc)
        | value :: rest -> (
            match api_group_of_value value with
            | Some group -> loop (group :: acc) rest
            | None -> None)
      in
      loop [] groups |> Option.map (fun groups -> (name, groups))
  | _ -> None

let ir_key key = VKeyword (":" ^ key)

let ir_object entries =
  VMap (List.map (fun (key, value) -> (ir_key key, value)) entries)

let annotation_value entries =
  ir_object
    (entries
    |> List.filter_map (fun (key, value) ->
        match value with VNil -> None | _ -> Some (key, value)))

let rec schema_value = function
  | Ref target ->
      ir_object [ ("kind", VString "Ref"); ("target", VString target) ]
  | Primitive prim ->
      ir_object [ ("kind", VString "Primitive"); ("prim", VString prim) ]
  | Literal value -> ir_object [ ("kind", VString "Literal"); ("value", value) ]
  | Optional item ->
      ir_object [ ("kind", VString "Optional"); ("item", schema_value item) ]
  | Array item ->
      ir_object [ ("kind", VString "Array"); ("item", schema_value item) ]
  | Struct fields ->
      ir_object
        [
          ("kind", VString "Struct");
          ("fields", VList (List.map field_value fields));
        ]
  | Union variants ->
      ir_object
        [
          ("kind", VString "Union");
          ("variants", VList (List.map schema_value variants));
        ]
  | Brand { brand; schema } ->
      ir_object
        [
          ("kind", VString "Brand");
          ("brand", VString brand);
          ("schema", schema_value schema);
        ]
  | Annotated { schema; annotations } -> (
      match annotation_value annotations with
      | VMap [] -> schema_value schema
      | annotation_map ->
          ir_object
            [
              ("kind", VString "Annotated");
              ("schema", schema_value schema);
              ("annotations", annotation_map);
            ])

and field_value field =
  ir_object
    [ ("name", VString field.name); ("schema", schema_value field.schema) ]

let endpoint_value (endpoint : endpoint) =
  let optional key = function
    | None -> None
    | Some value -> Some (key, schema_value value)
  in
  ir_object
    ([
       ("kind", VString "HttpEndpoint");
       ("name", VString endpoint.name);
       ("method", VString endpoint.method_);
       ("path", VString endpoint.path);
       ("success", schema_value endpoint.success);
       ("errors", VList (List.map schema_value endpoint.errors));
     ]
    @ List.filter_map Fun.id
        [ optional "payload" endpoint.payload; optional "query" endpoint.query ]
    )

let api_group_value (group : api_group) =
  ir_object
    [
      ("kind", VString "HttpApiGroup");
      ("name", VString group.name);
      ("pathParams", VList (List.map field_value group.path_params));
      ("endpoints", VList (List.map endpoint_value group.endpoints));
      ("handlers", VList group.handlers);
      ("annotations", annotation_value group.annotations);
    ]

let schema_payload_value ~name ~schema_kind schema =
  ir_object
    ([
       ("kind", VString "Schema");
       ("name", VString name);
       ("schema", schema_value schema);
     ]
    @
    match schema_kind with
    | None -> []
    | Some kind -> [ ("schemaKind", VString kind) ])

let http_api_payload_value ~name ~groups =
  ir_object
    [
      ("kind", VString "HttpApi");
      ("name", VString name);
      ("groups", VList (List.map api_group_value groups));
    ]
