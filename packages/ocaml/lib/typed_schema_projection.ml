type diagnostic = Type_diagnostic.t

let diagnostic = Type_diagnostic.make

let plain_scheme ty = Type_env.Forall ([], ty, [], Type_env.Plain)

let lower_diagnostics diagnostics =
  List.map
    (fun (diagnostic : Lower.diagnostic) ->
      Type_diagnostic.make ?span:diagnostic.span diagnostic.code
        diagnostic.message)
    diagnostics

let label_name = function
  | Ast.Symbol (_, name) | Ast.Keyword (_, name) | Ast.String (_, name) ->
      let has_keyword_prefix = String.length name > 0 && Char.equal name.[0] ':' in
      Some (if has_keyword_prefix then name else ":" ^ name)
  | _ -> None

let rec has_only_metadata_pairs = function
  | [] -> true
  | Ast.Keyword _ :: _ :: rest -> has_only_metadata_pairs rest
  | Ast.Symbol (_, name) :: _ :: rest
    when String.length name > 0 && Char.equal name.[0] ':' ->
      has_only_metadata_pairs rest
  | _ -> false

let split_trailing_metadata message items =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | ((Ast.Keyword _ | Ast.Symbol (_, _)) as key) :: rest as metadata -> (
      match key with
      | Ast.Keyword _ ->
          if has_only_metadata_pairs metadata then Ok (List.rev acc)
          else
            Error
              [
                diagnostic ~span:(Ast.expr_span key) "typecheck/define-schema"
                  message;
              ]
      | Ast.Symbol (_, name)
        when String.length name > 0 && Char.equal name.[0] ':' ->
          if has_only_metadata_pairs metadata then Ok (List.rev acc)
          else
            Error
              [
                diagnostic ~span:(Ast.expr_span key) "typecheck/define-schema"
                  message;
              ]
      | _ -> loop (key :: acc) rest)
    | item :: rest -> loop (item :: acc) rest
  in
  loop [] items

let rec metadata_symbol key = function
  | [] | [ _ ] -> None
  | Ast.Keyword (_, name) :: value :: _rest
  | Ast.Symbol (_, name) :: value :: _rest
    when String.equal name key -> (
      match value with
      | Ast.Symbol (span, name) | Ast.String (span, name) ->
          Some (Core_ast.TESym (span, name))
      | _ -> None)
  | _ :: _ :: rest -> metadata_symbol key rest

let mechanics_builtin_type = function
  | "Any" | "_" | "Bool" | "Boolean" | "Bytes" | "DateTime" | "Float"
  | "Int" | "Json" | "Keyword" | "List" | "Map" | "Nil" | "Num" | "Number"
  | "Option" | "Str" | "String" | "Symbol" | "Syntax" | "TaggedUnion"
  | "Tuple" | "Unit" | "Union" | "Vector" ->
      true
  | _ -> false

let primitive_schema_type_name name =
  match String.lowercase_ascii name with
  | "string" -> Some "String"
  | "int" | "integer" -> Some "Int"
  | "float" -> Some "Float"
  | "number" -> Some "Number"
  | "bool" | "boolean" -> Some "Boolean"
  | "bytes" -> Some "Bytes"
  | "datetime" -> Some "DateTime"
  | "json" -> Some "Json"
  | "unit" -> Some "Unit"
  | _ -> None

let lowercase_initial name =
  String.length name > 0
  &&
  let first = name.[0] in
  Char.lowercase_ascii first = first && Char.uppercase_ascii first <> first

let uppercase_initial name =
  String.length name > 0
  &&
  let first = name.[0] in
  Char.uppercase_ascii first = first && Char.lowercase_ascii first <> first

let rec validate_schema_refs env owner = function
  | Core_ast.TERowOp (_, _, operands, _) -> validate_schema_refs_many env owner operands
  | Core_ast.TESym (span, name) ->
      if
        mechanics_builtin_type name || lowercase_initial name
        || String.equal name owner
        || Option.is_some (Type_env.lookup name env)
      then Ok ()
      else if uppercase_initial name then
        Error
          [
            diagnostic ~span "typecheck/define-schema"
              (Printf.sprintf "Unknown schema reference: %s" name);
          ]
      else Ok ()
  | Core_ast.TEFun (_, params, result) -> (
      match validate_schema_refs_many env owner params with
      | Error _ as error -> error
      | Ok () -> validate_schema_refs env owner result)
  | Core_ast.TEApp (_, callee, args) -> (
      match validate_schema_refs env owner callee with
      | Error _ as error -> error
      | Ok () -> validate_schema_refs_many env owner args)
  | Core_ast.TERow (_, fields, _) ->
      validate_schema_refs_many env owner (List.map snd fields)

and validate_schema_refs_many env owner =
  let rec loop = function
    | [] -> Ok ()
    | expr :: rest -> (
        match validate_schema_refs env owner expr with
        | Error _ as error -> error
        | Ok () -> loop rest)
  in
  loop

let literal_value_type_name = function
  | Ast.String _ -> Ok "String"
  | Ast.Int _ | Ast.Float _ -> Ok "Number"
  | Ast.Bool _ -> Ok "Boolean"
  | Ast.Nil _ -> Ok "Unit"
  | Ast.Keyword _ -> Ok "String"
  | Ast.Symbol (_, "nil") -> Ok "Unit"
  | bad ->
      Error
        [
          diagnostic ~span:(Ast.expr_span bad) "typecheck/define-schema"
            "Literal schema values must be strings, numbers, booleans, nil, \
             or keywords.";
        ]

let literal_schema_type_expr span values =
  match values with
  | [] ->
      Error
        [
          diagnostic ~span "typecheck/define-schema"
            "Literal schema expects at least one literal value.";
        ]
  | first :: rest -> (
      match literal_value_type_name first with
      | Error _ as error -> error
      | Ok first_type ->
          let rec loop = function
            | [] -> Ok (Core_ast.TESym (Ast.expr_span first, first_type))
            | value :: rest -> (
                match literal_value_type_name value with
                | Error _ as error -> error
                | Ok typ when String.equal typ first_type -> loop rest
                | Ok _ ->
                    Error
                      [
                        diagnostic ~span:(Ast.expr_span value)
                          "typecheck/define-schema"
                          "Literal schema values must have one primitive \
                           type.";
                      ])
          in
          loop rest)

let rec schema_expr_to_type_expr expr =
  match expr with
  | Ast.Symbol (span, name) | Ast.String (span, name) -> (
      match primitive_schema_type_name name with
      | Some name -> Ok (Core_ast.TESym (span, name))
      | None -> Lower_type.parse_type_expr expr |> Result.map_error lower_diagnostics)
  | Ast.List (span, Ast.Symbol (_, ("Struct" | "object" | "Object")) :: fields)
    ->
      fields_to_type_expr_fields fields
      |> Result.map (fun fields -> Core_ast.TERow (span, fields, None))
  | Ast.List
      ( span,
        Ast.Symbol (head_span, ("Array" | "array")) :: item :: metadata )
    when has_only_metadata_pairs metadata ->
      schema_expr_to_type_expr item
      |> Result.map (fun item ->
             Core_ast.TEApp
               (span, Core_ast.TESym (head_span, "List"), [ item ]))
  | Ast.List
      ( span,
        Ast.Symbol (head_span, ("Optional" | "optional")) :: item :: metadata )
    when has_only_metadata_pairs metadata ->
      schema_expr_to_type_expr item
      |> Result.map (fun item ->
             Core_ast.TEApp
               (span, Core_ast.TESym (head_span, "Option"), [ item ]))
  | Ast.List (_, Ast.Symbol (head_span, ("Map" | "map")) :: value :: metadata)
    when has_only_metadata_pairs metadata -> (
      match schema_expr_to_type_expr value with
      | Error _ as error -> error
      | Ok _ -> Ok (Core_ast.TESym (head_span, "Map")))
  | Ast.List
      ( _,
        Ast.Symbol (_, ("Ref" | "ref"))
        :: Ast.Symbol (target_span, target)
        :: metadata )
    when has_only_metadata_pairs metadata ->
      Ok (Core_ast.TESym (target_span, target))
  | Ast.List
      ( _,
        [
          Ast.Symbol (_, ("Brand" | "brand"));
          Ast.Symbol (brand_span, brand);
          _base_schema;
        ] ) ->
      Ok (Core_ast.TESym (brand_span, brand))
  | Ast.List (span, Ast.Symbol (head_span, ("Enum" | "enum")) :: values) ->
      enum_schema_type_expr span head_span values
  | Ast.List (span, Ast.Symbol (_, ("Literal" | "literal")) :: values) ->
      literal_schema_type_expr span values
  | Ast.List (span, Ast.Symbol (head_span, ("Tuple" | "tuple")) :: items) -> (
      match split_trailing_metadata "Tuple schema metadata must be keyword/value pairs." items with
      | Error _ as error -> error
      | Ok [] ->
          Error
            [
              diagnostic ~span "typecheck/define-schema"
                "Tuple schema expects at least one item schema.";
            ]
      | Ok items -> (
          match schema_exprs_to_type_exprs items with
          | Error _ as error -> error
          | Ok items ->
              Ok
                (Core_ast.TEApp
                   (span, Core_ast.TESym (head_span, "Tuple"), items))))
  | Ast.List (span, Ast.Symbol (head_span, ("Union" | "union")) :: variants)
    -> (
      match split_trailing_metadata "Union schema metadata must be keyword/value pairs." variants with
      | Error _ as error -> error
      | Ok variants -> (
      match variants with
      | [] ->
          Error
            [
              diagnostic ~span "typecheck/define-schema"
                "Union schema expects at least one variant schema.";
            ]
      | variants -> (
          match schema_exprs_to_type_exprs variants with
          | Error _ as error -> error
          | Ok variants ->
              Ok
                (Core_ast.TEApp
                   ( span,
                     Core_ast.TESym (head_span, "Union"),
                     variants )))))
  | Ast.List
      ( span,
        Ast.Symbol (head_span, ("TaggedUnion" | "tagged-union" | "taggedUnion"))
        :: rest ) -> (
      match tagged_union_variant_schemas span rest with
      | Error _ as error -> error
      | Ok variants ->
          Ok
            (Core_ast.TEApp
               ( span,
                 Core_ast.TESym (head_span, "TaggedUnion"),
                 variants )))
  | Ast.List
      ( span,
        Ast.Symbol
          ( _,
            ( ("Array" | "array" | "Optional" | "optional" | "Map" | "map"
              | "Ref" | "ref" | "Brand" | "brand") as name ) )
        :: _ )
    ->
      Error
        [
          diagnostic ~span "typecheck/define-schema"
            (Printf.sprintf "%s schema has the wrong arity." name);
        ]
  | Ast.List (_, (Ast.Symbol (_, _) as head) :: metadata)
    when metadata <> [] && has_only_metadata_pairs metadata -> (
      match metadata_symbol ":brand" metadata with
      | Some branded -> Ok branded
      | None -> schema_expr_to_type_expr head)
  | _ -> Lower_type.parse_type_expr expr |> Result.map_error lower_diagnostics

and field_to_type_expr_field = function
  | Ast.Vector (_, [ name; schema ])
  | Ast.List (_, [ name; schema ])
  | Ast.List (_, [ Ast.Symbol (_, "field"); name; schema ]) -> (
      match (label_name name, schema_expr_to_type_expr schema) with
      | Some label, Ok typ -> Ok (label, typ)
      | _, Error diagnostics -> Error diagnostics
      | None, _ ->
          Error
            [
              diagnostic ~span:(Ast.expr_span name) "typecheck/define-schema"
                "Struct schema field names must be symbols, keywords, or \
                 strings.";
            ])
  | bad ->
      Error
        [
          diagnostic ~span:(Ast.expr_span bad) "typecheck/define-schema"
            "Struct schema fields must be [name SchemaExpr] or (field name \
             SchemaExpr).";
        ]

and fields_to_type_expr_fields fields =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | field :: rest -> (
        match field_to_type_expr_field field with
        | Error _ as error -> error
        | Ok field -> loop (field :: acc) rest)
  in
  loop [] fields

and schema_exprs_to_type_exprs exprs =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | expr :: rest -> (
        match schema_expr_to_type_expr expr with
        | Error _ as error -> error
        | Ok typ -> loop (typ :: acc) rest)
  in
  loop [] exprs

and enum_schema_type_expr span head_span = function
  | [] ->
      Error
        [
          diagnostic ~span "typecheck/define-schema"
            "Enum schema expects at least one value.";
        ]
  | values ->
      let rec loop = function
        | [] -> Ok (Core_ast.TESym (head_span, "String"))
        | value :: rest -> (
            match label_name value with
            | Some _ -> loop rest
            | None ->
                Error
                  [
                    diagnostic ~span:(Ast.expr_span value)
                      "typecheck/define-schema"
                      "Enum schema values must be symbols, keywords, or \
                       strings.";
                  ])
      in
      loop values

and tagged_union_variant_schemas span = function
  | discriminator :: variants -> (
      match label_name discriminator with
      | None ->
          Error
            [
              diagnostic ~span:(Ast.expr_span discriminator)
                "typecheck/define-schema"
                "TaggedUnion schema expects a discriminator.";
            ]
      | Some _ -> (
          match variants with
          | [] ->
              Error
                [
                  diagnostic ~span "typecheck/define-schema"
                    "TaggedUnion schema expects at least one variant schema.";
                ]
          | variants -> (
              match
                split_trailing_metadata
                  "TaggedUnion schema metadata must be keyword/value pairs."
                  variants
              with
              | Error _ as error -> error
              | Ok [] ->
                  Error
                    [
                      diagnostic ~span "typecheck/define-schema"
                        "TaggedUnion schema expects at least one variant schema.";
                    ]
              | Ok variants -> tagged_union_variants_to_type_exprs variants)))
  | [] ->
      Error
        [
          diagnostic ~span "typecheck/define-schema"
            "TaggedUnion schema expects a discriminator and variant schemas.";
        ]

and tagged_union_variants_to_type_exprs variants =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | Ast.Vector (_, [ tag; schema ]) :: rest -> (
        match label_name tag with
        | None ->
            Error
              [
                diagnostic ~span:(Ast.expr_span tag) "typecheck/define-schema"
                  "TaggedUnion variant tags must be symbols, keywords, or \
                   strings.";
              ]
        | Some _ -> (
            match schema_expr_to_type_expr schema with
            | Error _ as error -> error
            | Ok typ -> loop (typ :: acc) rest))
    | bad :: _ ->
        Error
          [
            diagnostic ~span:(Ast.expr_span bad) "typecheck/define-schema"
              "TaggedUnion variants must be [tag SchemaExpr].";
          ]
  in
  loop [] variants

let bind env name schema =
  match schema_expr_to_type_expr schema with
  | Error _ as error -> error
  | Ok type_expr -> (
      match validate_schema_refs env name type_expr with
      | Error _ as error -> error
      | Ok () -> (
      match Type_resolve.resolve env type_expr with
      | Error _ as error -> error
      | Ok ty -> Ok (Type_env.bind name (plain_scheme ty) env)))

let is_projection_expr = function
  | Ast.Symbol (_, name) ->
      String.length name = 0 || not (Char.equal name.[0] ':')
  | Ast.List
      ( _,
        Ast.Symbol
          ( _,
            ( "Struct" | "Array" | "Optional" | "Ref" | "Brand" | "Literal"
            | "Enum" | "Tuple" | "Union" | "TaggedUnion" | "Map" | "object"
            | "Object" | "array" | "optional" | "ref" | "brand" | "literal"
            | "enum" | "tuple" | "union" | "tagged-union" | "taggedUnion"
            | "map" ) )
        :: _ ) ->
      true
  | Ast.List (_, Ast.Symbol (_, name) :: metadata)
    when String.length name > 0
         && not (Char.equal name.[0] ':')
         && metadata <> [] && has_only_metadata_pairs metadata ->
      true
  | _ -> false
