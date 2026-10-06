open Mechanics_artifact_payload
open Mechanics_signature_json

let diagnostic = Mechanics_artifact_payload.diagnostic

let scalar_name = function
  | Ast.Symbol (_, name) | Ast.Keyword (_, name) | Ast.String (_, name) ->
      let has_keyword_prefix =
        String.length name > 0 && Char.equal name.[0] ':'
      in
      Some (if has_keyword_prefix then String.sub name 1 (String.length name - 1) else name)
  | _ -> None

let field_name = scalar_name

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
      | Some pairs -> Some ((String.sub key 1 (String.length key - 1), value) :: pairs)
      | None -> None)
  | _ -> None

let has_metadata_pairs values = Option.is_some (metadata_pairs values)

let is_schema_projection_expr = function
  | Ast.Symbol (_, name) ->
      String.length name = 0 || not (Char.equal name.[0] ':')
  | Ast.List
      ( _,
        Ast.Symbol
          ( _,
            ( "Struct" | "Array" | "Option" | "Optional" | "Ref" | "Brand" | "Enum"
            | "Literal" | "Tuple" | "Union" | "TaggedUnion" | "Map" | "object"
            | "Object" | "array" | "optional" | "ref" | "brand" | "enum"
            | "literal" | "tuple" | "union" | "tagged-union" | "taggedUnion"
            | "map" ) )
        :: _ ) ->
      true
  | Ast.List (_, Ast.Symbol (_, name) :: metadata)
    when String.length name > 0
         && not (Char.equal name.[0] ':')
         && metadata <> [] && has_metadata_pairs metadata ->
      true
  | _ -> false

let is_schema_form = function
  | Ast.List
      ( _,
        [
          Ast.Symbol (_, "__schema");
          Ast.Symbol (_, _);
          schema_expr;
        ] ) ->
      is_schema_projection_expr schema_expr
  | _ -> false

let is_fields_block = function
  | Ast.List (_, (Ast.Keyword (_, ":fields") | Ast.Symbol (_, ":fields")) :: _) ->
      true
  | _ -> false

let is_methods_block = function
  | Ast.List (_, (Ast.Keyword (_, ":methods") | Ast.Symbol (_, ":methods")) :: _) ->
      true
  | _ -> false

let is_error_form = function
  | Ast.List (_,Ast.Symbol (_, ("__error" | "__class")) :: Ast.Symbol _ :: fields_expr :: _) ->
      is_fields_block fields_expr
  | _ -> false

let is_service_form = function
  | Ast.List
      ( _,
        [
          Ast.Symbol (_, "__service");
          Ast.Symbol (_, _);
          methods_expr;
        ] ) ->
      is_methods_block methods_expr
  | _ -> false

let is_operation_form = function
  | Ast.List (_, Ast.Symbol (_, "__operation") :: _) -> true
  | _ -> false

let is_layer_form = function
  | Ast.List (_, Ast.Symbol (_, "__layer") :: _) -> true
  | _ -> false

let is_mechanics_form expr =
  is_schema_form expr || is_error_form expr || is_service_form expr
  || is_operation_form expr || is_layer_form expr

(* `(define name value)` with a `(: name Type)` signature is a typed constant
   or helper function. It is projected only from sources that already contain
   mechanics forms, so ordinary typed Forma code keeps its existing meaning. *)
let is_typed_define signatures = function
  | Ast.List (_, Ast.Symbol (_, "define") :: Ast.Symbol (_, name) :: _) ->
      List.mem_assoc name signatures
  | _ -> false

let has_mechanics_forms exprs =
  List.exists is_mechanics_form (Surface.effect_program (Surface_action.program exprs))

let projected_form_predicate ?(include_pure=true) ?(module_mode=false) exprs =
  let normalized = Surface.effect_program (Surface_action.program exprs) in
  let include_pure = include_pure || List.exists (fun e -> List.mem (Option.value ~default:"" (Surface.head e)) ["__operation";"__service";"__layer"]) normalized in
  let signatures = if not module_mode && not (List.exists is_mechanics_form normalized) then [] else
    operation_signatures normalized |> List.filter (fun (n,_) -> include_pure || List.exists (function Ast.List (_,Ast.Symbol (_,"__operation") :: Ast.Symbol (_,id) :: _) -> n=id | _ -> false) normalized) in
  let projected_spans = List.filter_map (fun expr -> if is_mechanics_form expr || is_typed_define signatures expr || (match expr with Ast.List (_, [(Ast.Symbol (_,":") | Ast.Keyword (_,":"));Ast.Symbol (_,n);_]) -> List.mem_assoc n signatures | _ -> false) then Some (Ast.expr_span expr) else None) normalized in
  fun expr -> List.mem (Ast.expr_span expr) projected_spans

let schema_payload name schema =
  Ir_json.Object
    [
      ("kind", Ir_json.String "SchemaDef");
      ("name", Ir_json.String name);
      ("schema", schema);
    ]

let error_payload ?(kind = "ErrorDef") ?status name fields =
  Ir_json.Object
    ([
      ("kind", Ir_json.String kind);
      ("name", Ir_json.String name);
      ( "schema",
        kinded "Struct" [ ("fields", Ir_json.Array fields) ] );
    ] @ (match status with None -> [] | Some status -> ["status",Ir_json.Int status]))

let service_payload name methods =
  Ir_json.Object
    [
      ("kind", Ir_json.String "ServiceDef");
      ("name", Ir_json.String name);
      ("methods", Ir_json.Array methods);
    ]

let effect_payload name params effect_json body =
  let capabilities =
    match effect_json with
    | Ir_json.Object entries ->
        Option.value (List.assoc_opt "requirements" entries)
          ~default:(Ir_json.Array [])
    | _ -> Ir_json.Array []
  in
  Ir_json.Object
    [
      ("kind", Ir_json.String "EffectDef");
      ("name", Ir_json.String name);
      ("params", Ir_json.Array params);
      ("effect", effect_json);
      ( "authority",
        Ir_json.Object [ ("capabilities", capabilities) ] );
      ("body", body);
    ]

let json_field name = function
  | Ir_json.Object entries -> List.assoc_opt name entries
  | _ -> None

let service_method_effects exprs =
  let collect_method service_name acc method_expr =
    match method_to_json service_name method_expr with
    | Error _ -> acc
    | Ok method_json -> (
      match (json_field "name" method_json, json_field "effect" method_json) with
      | Some (Ir_json.String method_name), Some effect_json ->
          let effect_json = match json_field "value" method_json,effect_json with Some (Ir_json.Bool true),Ir_json.Object fields -> Ir_json.Object (fields @ ["value",Ir_json.Bool true]) | _ -> effect_json in
          ((service_name ^ "." ^ method_name), effect_json) :: acc
      | _ -> acc)
  in
  List.fold_left
    (fun acc -> function
      | Ast.List
          ( _,
            [
              Ast.Symbol (_, "__service");
              Ast.Symbol (_, service_name);
              Ast.List
                ( _,
                  (Ast.Keyword (_, ":methods") | Ast.Symbol (_, ":methods"))
                  :: methods );
            ] ) ->
          List.fold_left (collect_method service_name) acc methods
      | _ -> acc)
    [] exprs

let operation_effects signatures exprs =
  List.filter_map
    (function
      | Ast.List
          ( _,
            Ast.Symbol (_, "__operation") :: Ast.Symbol (_, name)
            :: (Ast.Vector _ as params_expr) :: _ ) -> (
          match List.assoc_opt name signatures with
          | None -> None
          | Some signature -> (
              match operation_signature_to_json signature params_expr with
              | Ok (_, effect_json) -> Some (name, effect_json)
              | Error _ -> None))
      | _ -> None)
    exprs

let packageable ~source_id ~form_index ~span kind name payload =
  let declaration =
    match Canonical_ir_decl.declaration_of_json payload with
    | Some declaration -> declaration
    | None -> failwith "mechanics artifact payload must include a kind"
  in
  let summary =
    Artifact_summary_types.make_declaration_summary ~kind ~name:(Some name)
      ~type_name:kind
  in
  Packageable_declaration.make ~diagnostics:[]
    ~payload:
      (Packageable_declaration.make_payload
         ~value:(Artifact_validated_payload.of_declaration declaration))
    ~payload_contract:Artifact_payload_descriptor.empty ~validators:[] ~summary
    ~source_id ~form_index ~span

let schema_declaration ~source_id ~form_index span name schema_expr =
  match schema_expr_to_json schema_expr with
  | Error _ as error -> error
  | Ok schema ->
      Ok
        (packageable ~source_id ~form_index ~span "SchemaDef" name
           (schema_payload name schema))

let error_declaration ?(kind = "ErrorDef") ?status ~source_id ~form_index span name fields_expr =
  match fields_expr with
  | Ast.List (_, (Ast.Keyword (_, ":fields") | Ast.Symbol (_, ":fields")) :: fields) -> (
    match fields_to_json fields with
    | Error _ as error -> error
    | Ok fields ->
        Ok
          (packageable ~source_id ~form_index ~span kind name
             (error_payload ~kind ?status name fields)))
  | bad ->
      Error
        [
          diagnostic ~span:(Ast.expr_span bad) "artifact/error"
            "error expects a field record.";
        ]

let service_declaration ~source_id ~form_index span name methods_expr =
  match methods_expr with
  | Ast.List (_, (Ast.Keyword (_, ":methods") | Ast.Symbol (_, ":methods")) :: methods)
    -> (
    match methods_to_json name methods with
    | Error _ as error -> error
    | Ok methods ->
        Ok
          (packageable ~source_id ~form_index ~span "ServiceDef" name
             (service_payload name methods)))
  | bad ->
      Error
        [
          diagnostic ~span:(Ast.expr_span bad) "artifact/service"
            "__service expects a (:methods ...) block.";
        ]

let operation_declaration ~source_id ~form_index span signatures service_effects
    operation_effects name params_expr body_exprs =
  match List.assoc_opt name signatures with
  | None ->
      Error
        [
          diagnostic ~span "artifact/effect"
            "__operation requires a preceding type signature.";
        ]
  | Some signature -> (
    match operation_signature_to_json signature params_expr with
    | Error _ as error -> error
    | Ok (params, effect_json) ->
        let context =
          Mechanics_value_json.make_context ~source_id ~service_effects
            ~operation_effects effect_json
        in
        let body = Mechanics_effect_body_json.body_forms_json context body_exprs in
        match Mechanics_value_json.context_diagnostics context with
        | _ :: _ as diagnostics -> Error diagnostics
        | [] ->
            Ok
              (packageable ~source_id ~form_index ~span "EffectDef" name
                 (match effect_payload name params effect_json body with Ir_json.Object fields when Surface.head signature = Some "Effect" -> Ir_json.Object (fields @ ["value",Ir_json.Bool true]) | payload -> payload)))

let packaged ~source_id ~form_index ~span name = function
  | Error _ as error -> error
  | Ok (kind, payload) -> Ok (packageable ~source_id ~form_index ~span kind name payload)

let declaration ~source_id ~form_index signatures service_effects operation_effects =
  function
  | Ast.List
      ( span,
        [ Ast.Symbol (_, "__schema"); Ast.Symbol (_, name); schema_expr ] )
    ->
      schema_declaration ~source_id ~form_index span name schema_expr
  | Ast.List (span, Ast.Symbol (_, "__schema") :: _) ->
      Error
        [
          diagnostic ~span "artifact/schema"
            "__schema expects a schema name and schema expression.";
        ]
  | Ast.List
      ( span,
        [
          Ast.Symbol (_, (("__error" | "__class") as head));
          Ast.Symbol (_, name);
          fields_expr;
        ] ) ->
      let kind = if head = "__class" then "ClassDef" else "ErrorDef" in
      error_declaration ~kind ~source_id ~form_index span name fields_expr
  | Ast.List (span, [Ast.Symbol (_,"__error");Ast.Symbol (_,name);fields;Ast.Keyword (_,":status");Ast.Int (_,status)]) when status>=400 && status<=599 ->
      error_declaration ~status ~source_id ~form_index span name fields
  | Ast.List (span, Ast.Symbol (_, ("__error" | "__class")) :: _) ->
      Error
        [
          diagnostic ~span "artifact/error"
            "error expects an error name and field record.";
        ]
  | Ast.List
      ( span,
        [
          Ast.Symbol (_, "__service");
          Ast.Symbol (_, name);
          methods_expr;
        ] )
    ->
      service_declaration ~source_id ~form_index span name methods_expr
  | Ast.List (span, Ast.Symbol (_, "__service") :: _) ->
      Error
        [
          diagnostic ~span "artifact/service"
            "__service expects a service name and (:methods ...) block.";
        ]
  | Ast.List
      ( span,
        Ast.Symbol (_, "__operation") :: Ast.Symbol (_, name)
        :: (Ast.Vector (_, _) as params_expr) :: (_ :: _ as body_exprs) ) ->
      operation_declaration ~source_id ~form_index span signatures
        service_effects operation_effects name params_expr body_exprs
  | Ast.List (span, Ast.Symbol (_, "__operation") :: _) ->
      Error
        [
          diagnostic ~span "artifact/effect"
            "__operation expects a name, parameter vector, and body.";
        ]
  | Ast.List (span, [ Ast.Symbol (_, "define"); Ast.Symbol (_, name); value_expr ])
    as expr ->
      Mechanics_declaration_json.function_payload ~source_id expr name
        (List.assoc name signatures) value_expr
      |> packaged ~source_id ~form_index ~span name
  | Ast.List (span, Ast.Symbol (_, "__layer") :: name_expr :: (_ :: _ as sections))
    as expr -> (
      match Mechanics_value_json.sym_name name_expr with
      | None ->
          Error
            [
              diagnostic ~span:(Ast.expr_span name_expr) "artifact/layer"
                "layer expects a layer name.";
            ]
      | Some name ->
          Mechanics_declaration_json.layer_payload ~source_id ~service_effects
            ~operation_effects expr name (List.assoc_opt name signatures) sections
          |> Result.map (fun payload -> ("LayerDef", payload))
          |> packaged ~source_id ~form_index ~span name)
  | Ast.List (span, Ast.Symbol (_, "__layer") :: _) ->
      Error
        [
          diagnostic ~span "artifact/layer"
            "layer expects a name and a layer body.";
        ]
  | _ -> Error []

let declarations ?context ?(module_mode=false) ~source_id exprs =
  let types = List.filter_map (function Ast.List (_, [Ast.Symbol (_,"type");Ast.Symbol (_,n);t]) -> Some (n,t) | _ -> None) exprs in
  let consumed = ref [] in
  let rec visit = function
    | Ast.Symbol (_,n) when List.mem_assoc n types && not (List.mem n !consumed) -> consumed := n :: !consumed; visit (List.assoc n types)
    | Ast.List (_,items) | Ast.Vector (_,items) -> List.iter visit items
    | Ast.Map (_,fields) -> List.iter (fun (_,t) -> visit t) fields
    | _ -> () in
  List.iter (function Ast.List (_,Ast.Symbol (_,"form") :: _ :: args) ->
    let rec options = function
      | Ast.Keyword (_,(":ir" | ":types")) :: t :: rest -> visit t; options rest
      | _ :: rest -> options rest
      | [] -> () in options args
    | _ -> ()) exprs;
  let consumed_spans = List.filter_map (function Ast.List (s,[Ast.Symbol (_,"type");Ast.Symbol (_,n);_]) when List.mem n !consumed -> Some s | _ -> None) exprs in
  let exprs = Surface.effect_program (Surface_action.program exprs) in
  let context = Option.value ~default:exprs context in
  let signatures = operation_signatures context in
  let service_effects = service_method_effects context in
  let operation_effects = operation_effects signatures context in
  let is_projected = projected_form_predicate ~module_mode exprs in
  let rec loop acc form_index = function
    | [] -> Ok (List.rev acc)
    | expr :: rest when List.mem (Ast.expr_span expr) consumed_spans -> loop acc (form_index + 1) rest
    | expr :: rest when is_projected expr -> (
      match
        declaration ~source_id ~form_index signatures service_effects
          operation_effects expr
      with
      | Error [] -> loop acc (form_index + 1) rest
      | Error _ as error -> error
      | Ok declaration -> loop (declaration :: acc) (form_index + 1) rest)
    | _ :: rest -> loop acc (form_index + 1) rest
  in
  loop [] 0 exprs
