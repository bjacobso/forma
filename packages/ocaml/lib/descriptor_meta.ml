let span_value span =
  Value.VMap
    [
      (Value.VKeyword ":source-id", Value.VString span.Ast.source_id);
      (Value.VKeyword ":start-offset", Value.VInt span.start_offset);
      (Value.VKeyword ":end-offset", Value.VInt span.end_offset);
    ]

let rec type_value ty =
  match ty with
  | Type_expr.TList item ->
      Value.VMap
        [
          (Value.VKeyword ":kind", Value.VString "type-list");
          (Value.VKeyword ":item", type_value item);
        ]
  | Type_expr.TVector item ->
      Value.VMap
        [
          (Value.VKeyword ":kind", Value.VString "type-vector");
          (Value.VKeyword ":item", type_value item);
        ]
  | _ ->
      Value.VMap
        [
          (Value.VKeyword ":kind", Value.VString "type");
          (Value.VKeyword ":name", Value.VString (Type_expr.ty_to_string ty));
        ]

let rec core_expr_value expr =
  let base kind fields =
    Value.VMap
      ((Value.VKeyword ":kind", Value.VString kind)
      :: (Value.VKeyword ":span", span_value (Core_ast.expr_span expr))
      :: fields)
  in
  match expr with
  | Core_ast.Lit (_, literal) ->
      base "literal"
        [
          ( Value.VKeyword ":value",
            match literal with
            | Core_ast.LNil -> Value.VNil
            | Core_ast.LBool value -> Value.VBool value
            | Core_ast.LInt value -> Value.VInt value
            | Core_ast.LFloat value -> Value.VFloat value
            | Core_ast.LString value -> Value.VString value
            | Core_ast.LKeyword value -> Value.VKeyword value
            | Core_ast.LSymbol value -> Value.VSymbol value
            | Core_ast.LQuoted value -> Quote.value_of_syntax value );
        ]
  | Core_ast.Var (_, name) ->
      base "variable" [ (Value.VKeyword ":name", Value.VSymbol name) ]
  | Core_ast.App (_, Core_ast.Var (_, "__vector"), args) ->
      Value.VVector (List.map core_expr_value args)
  | Core_ast.App (_, Core_ast.Var (_, "list"), args) ->
      Value.VList (List.map core_expr_value args)
  | Core_ast.App (_, Core_ast.Var (_, name), args) ->
      base "application"
        [
          (Value.VKeyword ":form", Value.VSymbol name);
          (Value.VKeyword ":args", Value.VList (List.map core_expr_value args));
        ]
  | Core_ast.App (_, callee, args) ->
      base "application"
        [
          (Value.VKeyword ":callee", core_expr_value callee);
          (Value.VKeyword ":args", Value.VList (List.map core_expr_value args));
        ]
  | Core_ast.Ascribe (_, value, _) ->
      base "ascription" [ (Value.VKeyword ":value", core_expr_value value) ]
  | Core_ast.Record (_, fields) ->
      let field_value (field : Core_ast.field) =
        Value.VMap
          [
            (Value.VKeyword ":label", Value.VString field.label);
            (Value.VKeyword ":value", core_expr_value field.value);
          ]
      in
      base "record"
        [
          (Value.VKeyword ":fields", Value.VList (List.map field_value fields));
        ]
  | _ -> base "expression" []

let hook_input mode (application : Descriptor_protocol.descriptor_application) =
  Value.VMap
    ([
       (Value.VKeyword ":kind", Value.VString "descriptor-hook");
       (Value.VKeyword ":mode", Value.VString mode);
       (Value.VKeyword ":form", Value.VSymbol application.form_name);
       (Value.VKeyword ":span", span_value application.span);
       ( Value.VKeyword ":args",
         Value.VList (List.map core_expr_value application.args) );
     ]
    @
    match application.expected with
    | None -> []
    | Some expected ->
        [
          (Value.VKeyword ":expected-type", type_value expected);
          (Value.VKeyword ":expected", type_value expected);
        ])

let normalize_type_name name =
  if String.length name > 0 && name.[0] = ':' then
    String.sub name 1 (String.length name - 1)
  else name

let project_type_name row fields =
  "Project<" ^ row ^ ":" ^ String.concat "," fields ^ ">"

let lookup_value entries key = Value.lookup_map entries (Value.VKeyword key)

let type_map_parts entries =
  ( lookup_value entries ":kind",
    lookup_value entries ":type",
    lookup_value entries ":name",
    lookup_value entries ":item" )

let type_name_of_entries entries =
  match
    ( lookup_value entries ":kind",
      lookup_value entries ":type",
      lookup_value entries ":name" )
  with
  | Some (Value.VString "type-ref"), _, Some name
  | Some (Value.VString "type"), _, Some name
  | _, Some name, _ ->
      Eval_slot.scalar_string name
  | _ -> None

let type_name_of_value = function
  | Value.VMap entries -> type_name_of_entries entries
  | Value.VString name | Value.VSymbol name | Value.VKeyword name -> Some name
  | _ -> None

let type_expr_of_name ?(allow_named = false) name =
  match normalize_type_name name with
  | "Int" | "Num" -> Some Type_expr.TInt
  | "Float" -> Some Type_expr.TFloat
  | "Bool" -> Some Type_expr.TBool
  | "Str" | "String" -> Some Type_expr.TString
  | "Nil" | "Unit" -> Some Type_expr.TNil
  | "Keyword" -> Some Type_expr.TKeyword
  | "Symbol" -> Some Type_expr.TSymbol
  | "Syntax" -> Some Type_expr.TSyntax
  | "Any" | "_" -> Some Type_expr.TAny
  | "List" -> Some (Type_expr.TList Type_expr.TAny)
  | "Vector" -> Some (Type_expr.TVector Type_expr.TAny)
  | "Map" -> Some Type_expr.TMap
  | "Fn" -> Some (Type_expr.TFn ([], Type_expr.TAny))
  | "Declaration" -> Some Type_expr.TDeclaration
  | "TypeValue" -> Some Type_expr.TTypeValue
  | "FormDescriptor" -> Some Type_expr.TFormDescriptor
  | "ProtocolDescriptor" -> Some Type_expr.TProtocolDescriptor
  | name when allow_named -> Some (Type_expr.TNamed name)
  | _ -> None

let named_type_expr_of_value = function
  | Value.VMap entries -> (
      match type_name_of_entries entries with
      | Some name -> type_expr_of_name ~allow_named:true name
      | None -> None)
  | Value.VString name | Value.VSymbol name | Value.VKeyword name ->
      type_expr_of_name name
  | _ -> None

let rec item_type_expr wrap = function
  | Some item -> Option.map wrap (type_expr_of_value item)
  | None -> None

and record_field_type = function
  | Value.VMap field_entries -> (
      match
        (lookup_value field_entries ":label", lookup_value field_entries ":type")
      with
      | Some label, Some typ -> (
          match (Eval_slot.scalar_string label, type_expr_of_value typ) with
          | Some label, Some typ -> Some (label, typ)
          | _ -> None)
      | _ -> None)
  | _ -> None

and record_type_expr = function
  | Value.VList fields | Value.VVector fields ->
      Some (Type_expr.TRecord (List.filter_map record_field_type fields))
  | _ -> None

and projected_row_type_expr row fields =
  match type_name_of_value row with
  | Some row ->
      Some
        (Type_expr.TNamed
           (project_type_name row (Eval_meta_util.string_list fields)))
  | None -> None

and type_expr_of_value value =
  match value with
  | Value.VMap entries -> (
      match type_map_parts entries with
      | Some (Value.VString "type-list"), _, _, Some item ->
          item_type_expr (fun item -> Type_expr.TList item) (Some item)
      | Some (Value.VString "type-vector"), _, _, Some item ->
          item_type_expr (fun item -> Type_expr.TVector item) (Some item)
      | Some (Value.VString "type-record"), _, _, _ -> (
          match lookup_value entries ":fields" with
          | Some fields -> record_type_expr fields
          | _ -> None)
      | Some (Value.VString "type-project-row"), _, _, _ -> (
          match
            (lookup_value entries ":row", lookup_value entries ":fields")
          with
          | Some row, Some fields -> projected_row_type_expr row fields
          | _ -> None)
      | _ -> named_type_expr_of_value value)
  | _ -> named_type_expr_of_value value

let type_diagnostic_to_eval (diagnostic : Type_diagnostic.t) =
  Eval_common.diagnostic ?span:diagnostic.span diagnostic.code
    diagnostic.message

let core_expr_for_value application expr_value =
  let rec find_expr expr =
    if Value.equal (core_expr_value expr) expr_value then Some expr
    else
      match expr with
      | Core_ast.App (_, callee, args) -> (
          match find_expr callee with
          | Some _ as found -> found
          | None -> List.find_map find_expr args)
      | Core_ast.Ascribe (_, value, _) -> find_expr value
      | Core_ast.Record (_, fields) ->
          fields
          |> List.find_map (fun (field : Core_ast.field) ->
              find_expr field.value)
      | Core_ast.Let (_, bindings, body) -> (
          bindings
          |> List.find_map (fun (binding : Core_ast.binding) ->
              find_expr binding.expr)
          |> function
          | Some _ as found -> found
          | None -> find_expr body)
      | Core_ast.If (_, condition, consequent, alternate) -> (
          match find_expr condition with
          | Some _ as found -> found
          | None -> (
              match find_expr consequent with
              | Some _ as found -> found
              | None -> find_expr alternate))
      | Core_ast.Def (_, _, _, value) -> find_expr value
      | Core_ast.Match (_, scrutinee, arms) -> (
          match find_expr scrutinee with
          | Some _ as found -> found
          | None ->
              arms |> List.find_map (fun arm -> find_expr arm.Core_ast.body))
      | _ -> None
  in
  List.find_map find_expr application.Descriptor_protocol.args

let check_expr application _input expr_value typ_value =
  match
    (core_expr_for_value application expr_value, type_expr_of_value typ_value)
  with
  | None, _ ->
      Error
        [
          Eval_common.diagnostic "meta/check-expr"
            "meta/check-expr expected an expression from the descriptor hook \
             input.";
        ]
  | _, None ->
      Error
        [
          Eval_common.diagnostic "meta/check-type"
            "meta/check-expr expected a structured type value.";
        ]
  | Some expr, Some expected -> (
      match
        Typecheck.infer_core_expr application.Descriptor_protocol.type_env expr
      with
      | Error diagnostics ->
          Error (List.map type_diagnostic_to_eval diagnostics)
      | Ok actual -> (
          match
            Type_unify.unify_with_span (Core_ast.expr_span expr) expected actual
          with
          | Ok _ -> Ok (type_value expected)
          | Error diagnostics ->
              Error (List.map type_diagnostic_to_eval diagnostics)))

let infer_expr application _input expr_value =
  match core_expr_for_value application expr_value with
  | None ->
      Error
        [
          Eval_common.diagnostic "meta/infer-expr-type"
            "meta/infer-expr-type expected an expression from the descriptor \
             hook input.";
        ]
  | Some expr -> (
      match
        Typecheck.infer_core_expr application.Descriptor_protocol.type_env expr
      with
      | Ok typ -> Ok (type_value typ)
      | Error diagnostics ->
          Error (List.map type_diagnostic_to_eval diagnostics))

let apply_hook env hook_name mode application =
  let outer_lookup = Eval_meta.current_lookup_declaration () in
  let lookup =
    match outer_lookup with
    | Some lookup ->
        Eval_meta_util.overlay_lookup_option lookup (fun name ->
            Env.lookup name env)
    | None -> fun name -> Env.lookup name env
  in
  let result = Eval_meta.with_lookup_declaration lookup (fun () ->
      Eval_meta.with_check_expr (check_expr application) (fun () ->
          Eval_meta.with_infer_expr (infer_expr application) (fun () ->
              Eval.apply_named env hook_name (hook_input mode application)))) in
  Result.map_error (List.map (fun (diagnostic:Eval_common.diagnostic) ->
    match diagnostic.span with
    | Some span when span.source_id=application.span.source_id -> diagnostic
    | _ -> {diagnostic with span=Some application.span})) result
