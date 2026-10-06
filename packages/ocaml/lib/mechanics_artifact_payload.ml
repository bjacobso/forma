let diagnostic ?span code message = ({ Eval.span; code; message } : Eval.diagnostic)
let scalar_name = function
  | Ast.Symbol (_, name) | Ast.Keyword (_, name) | Ast.String (_, name) ->
      let prefixed = String.length name > 0 && Char.equal name.[0] ':' in
  Some (if prefixed then String.sub name 1 (String.length name - 1) else name)
  | Ast.Nil _ -> Some "nil"
  | _ -> None
let primitive_name name =
  match String.lowercase_ascii name with
  | "string" -> Some "String"
  | "int" | "integer" -> Some "Int"
  | "float" -> Some "Float"
  | "number" -> Some "Number"
  | "bool" | "boolean" -> Some "Bool"
  | "bytes" -> Some "Bytes"
  | "datetime" -> Some "DateTime"
  | "json" -> Some "Json"
  | "unit" -> Some "Unit"
  | _ -> None
let rec metadata_pairs = function
  | [] -> Some []
  | (Ast.Keyword (_, key) | Ast.Symbol (_, key)) :: value :: rest
    when String.length key > 0 && Char.equal key.[0] ':' -> (
      match metadata_pairs rest with
      | Some pairs ->
          Some ((String.sub key 1 (String.length key - 1), value) :: pairs)
      | None -> None)
  | _ -> None
let split_trailing_metadata values =
  let rec loop acc = function
    | [] -> Some (List.rev acc, [])
    | ((Ast.Keyword _ | Ast.Symbol (_, _)) as key) :: _ as metadata -> (
      match key with
      | Ast.Keyword _ -> (
          match metadata_pairs metadata with
          | Some pairs -> Some (List.rev acc, pairs)
          | None -> None)
      | Ast.Symbol (_, name)
        when String.length name > 0 && Char.equal name.[0] ':' -> (
          match metadata_pairs metadata with
          | Some pairs -> Some (List.rev acc, pairs)
          | None -> None)
      | _ -> (
          match metadata with
          | item :: rest -> loop (item :: acc) rest
          | [] -> Some (List.rev acc, [])))
    | item :: rest -> loop (item :: acc) rest
  in
  loop [] values

let scalar_json = function
  | Ast.Nil _ -> Some (Ir_json.String "nil")
  | Ast.Bool (_, value) -> Some (Ir_json.Bool value)
  | Ast.Int (_, value) -> Some (Ir_json.Int value)
  | Ast.Float (_, value) -> Some (Ir_json.Float value)
  | Ast.String (_, value) -> Some (Ir_json.String value)
  | Ast.Symbol (_, value) -> Some (Ir_json.String value)
  | Ast.Keyword (_, value) -> Some (Ir_json.String value)
  | _ -> None

let source_span_json = Mechanics_schema_json.source_span_json

let kinded ?span kind entries =
  let entries =
    match span with
    | Some span -> entries @ [ ("span", source_span_json span) ]
    | None -> entries
  in
  Ir_json.Object (("kind", Ir_json.String kind) :: entries)

let primitive ?span name = kinded ?span "Primitive" [ ("name", Ir_json.String name) ]
let ref_schema ?span name = kinded ?span "Ref" [ ("name", Ir_json.String name) ]

let apply_metadata ?span schema pairs =
  let brand, metadata =
    List.fold_left
      (fun (brand, metadata) (key, value) ->
        match (key, scalar_json value, scalar_name value) with
        | "brand", _, Some name -> (Some name, metadata)
        | "brand", _, None -> (brand, metadata)
        | _, Some value, _ -> (brand, (key, value) :: metadata)
        | _ -> (brand, metadata))
      (None, []) pairs
  in
  let schema =
    match brand with
    | Some name ->
        kinded ?span "Brand" [ ("name", Ir_json.String name); ("schema", schema) ]
    | None -> schema
  in
  match List.rev metadata with
  | [] -> schema
  | entries ->
      kinded ?span "Annotated"
        [ ("schema", schema); ("metadata", Ir_json.Object entries) ]

let rec schema_expr_to_json expr =
  match expr with
  | Ast.Symbol (span, name) | Ast.String (span, name) | Ast.Keyword (span, name) -> (
    match primitive_name name with
    | Some name -> Ok (primitive ~span name)
    | None -> Ok (ref_schema ~span name))
  | Ast.List (span, Ast.Symbol (_, ("Struct" | "object" | "Object")) :: fields)
    ->
      fields_to_json fields
      |> Result.map (fun fields ->
             kinded ~span "Struct" [ ("fields", Ir_json.Array fields) ])
  | Ast.List (span, Ast.Symbol (_, ("Array" | "array")) :: item :: metadata)
    -> (
    match metadata_pairs metadata with
    | None ->
        Error
          [
            diagnostic ~span:(Ast.expr_span expr) "artifact/schema"
              "Array schema metadata must be keyword/value pairs.";
          ]
    | Some metadata -> (
      match schema_expr_to_json item with
      | Error _ as error -> error
      | Ok item ->
          Ok
            (apply_metadata ~span
               (kinded ~span "Array" [ ("item", item) ])
               metadata)))
  | Ast.List
      (span, Ast.Symbol (_, ("Optional" | "optional")) :: item :: metadata)
    -> (
    match metadata_pairs metadata with
    | None ->
        Error
          [
            diagnostic ~span:(Ast.expr_span expr) "artifact/schema"
              "Optional schema metadata must be keyword/value pairs.";
          ]
    | Some metadata -> (
      match schema_expr_to_json item with
      | Error _ as error -> error
      | Ok item ->
          Ok
            (apply_metadata ~span
               (kinded ~span "Optional" [ ("item", item) ])
               metadata)))
  | Ast.List (span, Ast.Symbol (_, ("Map" | "map")) :: value :: metadata) -> (
    match metadata_pairs metadata with
    | None ->
        Error [ diagnostic ~span:(Ast.expr_span expr) "artifact/schema"
                  "Map schema metadata must be keyword/value pairs." ]
    | Some metadata -> (
      match schema_expr_to_json value with
      | Error _ as error -> error
      | Ok value ->
          let key = List.assoc_opt "key" metadata in
          let metadata = List.remove_assoc "key" metadata in
          (match (match key with None -> Ok [] | Some key -> Result.map (fun key -> ["key",key]) (schema_expr_to_json key)) with
          | Error _ as error -> error
          | Ok key -> Ok (apply_metadata ~span
                (kinded ~span "Map" (("value", value) :: key))
                metadata))))
  | Ast.List (span, [ Ast.Symbol (_, ("Map" | "map")) ]) ->
      Error [ diagnostic ~span "artifact/schema" "Map schema expects a value schema." ]
  | Ast.List (span, Ast.Symbol (_, ("Ref" | "ref")) :: target :: metadata) -> (
    match (scalar_name target, metadata_pairs metadata) with
    | Some target, Some metadata ->
        Ok (apply_metadata ~span (ref_schema ~span target) metadata)
    | None, _ ->
        Error
          [
            diagnostic ~span:(Ast.expr_span target) "artifact/schema"
              "Ref schema expects a symbolic target.";
          ]
    | _, None ->
        Error
          [
            diagnostic ~span:(Ast.expr_span expr) "artifact/schema"
              "Ref schema metadata must be keyword/value pairs.";
          ])
  | Ast.List (span, Ast.Symbol (_, ("Brand" | "brand")) :: brand :: base :: []) -> (
    match (scalar_name brand, schema_expr_to_json base) with
    | Some name, Ok schema ->
        Ok
          (kinded ~span "Brand"
             [ ("name", Ir_json.String name); ("schema", schema) ])
    | None, _ ->
        Error
          [
            diagnostic ~span:(Ast.expr_span brand) "artifact/schema"
              "Brand schema expects a symbolic brand name.";
          ]
    | _, (Error _ as error) -> error)
  | Ast.List (span, Ast.Symbol (_, ("Enum" | "enum")) :: values) ->
      Mechanics_schema_json.enum_schema_to_json
        ~kinded:(fun ~span -> kinded ~span) span values
  | Ast.List (span, Ast.Symbol (_, ("Literal" | "literal")) :: values) ->
      let rec loop acc = function
        | [] -> Ok (List.rev acc)
        | value :: rest -> (
          match scalar_json value with
          | Some value -> loop (value :: acc) rest
          | None ->
              Error
                [
                  diagnostic ~span:(Ast.expr_span value) "artifact/schema"
                    "Literal schema values must be scalar values.";
                ])
      in
      loop [] values
      |> Result.map (fun values ->
             kinded ~span "Literal" [ ("values", Ir_json.Array values) ])
  | Ast.List (span, Ast.Symbol (_, ("Tuple" | "tuple")) :: items) ->
      Mechanics_schema_json.tuple_schema_to_json ~schema_expr_to_json
        ~apply_metadata span items
  | Ast.List (span, Ast.Symbol (_, ("Union" | "union")) :: variants) -> (
    match split_trailing_metadata variants with
    | None ->
        Error
          [
            diagnostic ~span "artifact/schema"
              "Union schema metadata must be keyword/value pairs.";
          ]
    | Some (variants, metadata) -> (
    match variants with
    | [] ->
        Error
          [
            diagnostic ~span "artifact/schema"
              "Union schema expects at least one variant schema.";
          ]
    | variants -> (
        match schemas_to_json variants with
        | Error _ as error -> error
        | Ok variants ->
            Ok
              (apply_metadata ~span
                 (kinded ~span "Union" [ ("variants", Ir_json.Array variants) ])
                 metadata))))
  | Ast.List (span, Ast.Symbol (_, ("TaggedUnion" | "tagged-union" | "taggedUnion")) :: rest) -> (
    match rest with
    | discriminator :: variants -> (
      match split_trailing_metadata variants with
      | None ->
          Error
            [
              diagnostic ~span "artifact/schema"
                "TaggedUnion schema metadata must be keyword/value pairs.";
            ]
      | Some (variants, metadata) -> (
      match
        Mechanics_schema_json.tagged_union_to_json ~schema_expr_to_json span
          (discriminator :: variants)
      with
    | Error _ as error -> error
    | Ok (discriminator, variants) ->
        Ok
          (apply_metadata ~span
             (kinded ~span "TaggedUnion"
                [
                  ("discriminator", Ir_json.String discriminator);
                  ("variants", Ir_json.Array variants);
                ])
             metadata)))
    | [] ->
        Error
          [
            diagnostic ~span "artifact/schema"
              "TaggedUnion schema expects a discriminator and variant schemas.";
          ])
  | Ast.List (span, Ast.Symbol (_, name) :: metadata) -> (
    match (primitive_name name, metadata_pairs metadata) with
    | Some name, Some metadata ->
        Ok (apply_metadata ~span (primitive ~span name) metadata)
    | None, Some metadata ->
        Ok (apply_metadata ~span (ref_schema ~span name) metadata)
    | _, None ->
        Error
          [
            diagnostic ~span:(Ast.expr_span expr) "artifact/schema"
              "Schema metadata must be keyword/value pairs.";
          ])
  | _ ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "artifact/schema"
            "Expected a schema symbol or schema expression.";
        ]

and field_to_json = function
  | Ast.Vector (span, [ name; schema ])
  | Ast.List (span, [ name; schema ])
  | Ast.List (span, [ Ast.Symbol (_, "field"); name; schema ]) -> (
    match (scalar_name name, schema_expr_to_json schema) with
    | Some name, Ok schema ->
        Ok
          (Ir_json.Object
             [
               ("name", Ir_json.String name);
               ("schema", schema);
               ("span", source_span_json span);
             ])
    | None, _ ->
        Error
          [
            diagnostic ~span:(Ast.expr_span name) "artifact/schema-field"
              "Struct schema field names must be symbols, keywords, or strings.";
          ]
    | _, (Error _ as error) -> error)
  | bad ->
      Error
        [
          diagnostic ~span:(Ast.expr_span bad) "artifact/schema-field"
            "Struct schema fields must be [name SchemaExpr] or (field name SchemaExpr).";
        ]

and fields_to_json fields =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | field :: rest -> (
      match field_to_json field with
      | Error _ as error -> error
      | Ok field -> loop (field :: acc) rest)
  in
  loop [] fields

and schemas_to_json schemas =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | schema :: rest -> (
      match schema_expr_to_json schema with
      | Error _ as error -> error
      | Ok schema -> loop (schema :: acc) rest)
  in
  loop [] schemas

let rec type_expr_to_json expr =
  let one kind item =
    Result.map (fun item -> kinded kind [ ("item", item) ]) (type_expr_to_json item)
  in
  let arity_error head =
    Error [ diagnostic ~span:(Ast.expr_span expr) "artifact/type"
              (head ^ " type expects one argument.") ]
  in
  match expr with
  | Ast.List (_, Ast.Symbol (_, "Effect") :: _) -> effect_type_to_json expr None
  | Ast.List (_, Ast.Symbol (_, (("Option" | "Optional") as head)) :: [ item ]) ->
      one head item
  | Ast.List (_, Ast.Symbol (_, "Ref") :: [ item ]) -> one "RefCell" item
  | Ast.List (_, Ast.Symbol (_, ("Array" | "List")) :: [ item ]) -> one "Array" item
  | Ast.List (_, [Ast.Symbol (_, "Map");value;(Ast.Keyword (_,":key") | Ast.Symbol (_,":key"));key]) ->
      (match type_expr_to_json key, type_expr_to_json value with
      | Ok key, Ok value -> Ok (kinded "Map" ["key",key;"value",value])
      | Error e, _ | _, Error e -> Error e)
  | Ast.List (_, Ast.Symbol (_, "Map") :: [ value ]) ->
      Result.map (fun value -> kinded "Map" [ ("value", value) ]) (type_expr_to_json value)
  | Ast.List (_, Ast.Symbol (_, "Tuple") :: items) ->
      Mechanics_schema_json.tuple_type_to_json ~type_expr_to_json expr items
  | Ast.List (_, [ Ast.Symbol (_, "Fiber"); success; errors ]) -> (
      match (type_expr_to_json success, name_set_json "errors" errors) with
      | (Error _ as error), _ | _, (Error _ as error) -> error
      | Ok success, Ok errors ->
          Ok (kinded "Fiber" [ ("success", success); ("errors", errors) ]))
  | Ast.List (span, [ Ast.Symbol (_, "Stream"); item; errors; requirements ]) -> (
      match
        ( type_expr_to_json item,
          name_set_json "errors" errors,
          name_set_json "requirements" requirements )
      with
      | (Error _ as error), _, _ | _, (Error _ as error), _ | _, _, (Error _ as error) ->
          error
      | Ok item, Ok errors, Ok requirements ->
          Ok
            (kinded ~span "Stream"
               [ ("item", item); ("errors", errors); ("requirements", requirements) ]))
  | Ast.List (_, [ Ast.Symbol (_, "Result"); success; failure ]) -> (
      match (type_expr_to_json success, type_expr_to_json failure) with
      | (Error _ as error), _ | _, (Error _ as error) -> error
      | Ok success, Ok failure ->
          Ok (kinded "Result" [ ("success", success); ("failure", failure) ]))
  | Ast.List (_, Ast.Symbol (_, "->") :: (_ :: _ as items)) -> (
      let inputs = List.rev (List.tl (List.rev items)) in
      match
        ( Mechanics_schema_json.to_json_list type_expr_to_json [] inputs,
          type_expr_to_json (List.hd (List.rev items)) )
      with
      | (Error _ as error), _ | _, (Error _ as error) -> error
      | Ok params, Ok result ->
          Ok (kinded "Function" [ ("params", Ir_json.Array params); ("result", result) ]))
  | Ast.List (_, Ast.Symbol (_, (("Option" | "Optional" | "Ref" | "Array" | "List" | "Map") as head)) :: _) ->
      arity_error head
  | Ast.List (_, Ast.Symbol (_, "Fiber") :: _) ->
      Error [ diagnostic ~span:(Ast.expr_span expr) "artifact/type"
                "Fiber type expects (Fiber Success [Errors...])." ]
  | Ast.List (_, Ast.Symbol (_, "Stream") :: _) ->
      Error [ diagnostic ~span:(Ast.expr_span expr) "artifact/type"
                "Stream type expects (Stream Item [Errors...] [Requirements...])." ]
  | Ast.List (_, Ast.Symbol (_, "Result") :: _) ->
      Error [ diagnostic ~span:(Ast.expr_span expr) "artifact/type"
                "Result type expects (Result Success Failure)." ]
  | Ast.List (_, [ Ast.Symbol (_, "->") ]) ->
      Error [ diagnostic ~span:(Ast.expr_span expr) "artifact/type"
                "Function type expects (-> Input... Output)." ]
  | _ -> schema_expr_to_json expr

and effect_type_to_json expr operation_requirement =
  match expr with
  | Ast.List
      ( span,
        [
          Ast.Symbol (_, "Effect");
          success_expr;
          Ast.Vector (_, error_exprs);
          Ast.Vector (_, requirement_exprs);
        ] ) -> (
      match
        ( type_expr_to_json success_expr,
          symbolic_set_to_json "errors" error_exprs,
          symbolic_set_to_json "requirements" requirement_exprs )
      with
      | (Error diagnostics, _, _)
      | (_, Error diagnostics, _)
      | (_, _, Error diagnostics) ->
          Error diagnostics
      | (Ok success, Ok errors, Ok requirements) ->
          let requirements =
            match operation_requirement with
            | Some operation_requirement
              when not (List.mem operation_requirement requirements) ->
                requirements @ [ operation_requirement ]
            | _ -> requirements
          in
          Ok
            (kinded ~span "Effect"
               [
                 ("success", success);
                 ( "errors",
                   Ir_json.Array
                     (List.map (fun name -> Ir_json.String name) errors) );
                 ( "requirements",
                   Ir_json.Array
                     (List.map (fun name -> Ir_json.String name) requirements) );
               ]))
  | _ ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "artifact/effect-type"
            "Effect type expects (Effect Success [Errors...] [Requirements...]).";
        ]

and name_set_json label = function
  | Ast.Vector (_, names) ->
      Result.map
        (fun names -> Ir_json.Array (List.map (fun name -> Ir_json.String name) names))
        (symbolic_set_to_json label names)
  | bad ->
      Error [ diagnostic ~span:(Ast.expr_span bad) "artifact/effect-type"
                ("Effect " ^ label ^ " must be a vector.") ]

and symbolic_set_to_json label exprs =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | expr :: rest -> (
      match scalar_name expr with
      | Some name ->
          if List.mem name acc then loop acc rest else loop (name :: acc) rest
      | None ->
          Error
            [
              diagnostic ~span:(Ast.expr_span expr) "artifact/effect-type"
                ("Effect " ^ label ^ " entries must be symbolic names.");
            ])
  in
  loop [] exprs
