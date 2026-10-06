let keyword_literal_warning_json span keyword =
  Printf.sprintf
    "{\"span\":{\"sourceId\":%s,\"startOffset\":%d,\"endOffset\":%d},\"severity\":\"warning\",\"message\":%s,\"notes\":[],\"fixes\":[]}"
    (Value.string_json span.Ast.source_id)
    span.start_offset span.end_offset
    (Value.string_json
       (Printf.sprintf
          "Keyword %s used as a value. Keywords are self-evaluating literals, \
           not variable references."
          keyword))

let should_warn_keyword _keyword = false

let rec keyword_literal_warnings expr =
  let recurse exprs = List.concat_map keyword_literal_warnings exprs in
  let rec binding_value_warnings = function
    | _binding_pattern :: value_expr :: rest ->
        keyword_literal_warnings value_expr @ binding_value_warnings rest
    | _ -> []
  in
  match expr with
  | Ast.Keyword (span, keyword) when should_warn_keyword keyword ->
      [ keyword_literal_warning_json span keyword ]
  | Ast.List (_, [ Ast.Symbol (_, "get"); record_expr; _label_expr ]) ->
      keyword_literal_warnings record_expr
  | Ast.List
      (_, Ast.Symbol (_, ("let" | "let*")) :: Ast.Vector (_, bindings) :: body)
    ->
      binding_value_warnings bindings @ recurse body
  | Ast.List
      (_, Ast.Symbol (_, ("fn" | "lambda")) :: Ast.Vector (_, _params) :: body)
    ->
      recurse body
  | Ast.List
      (_, [ Ast.Symbol (_, ("define" | "def")); Ast.Symbol (_, _); value_expr ])
    ->
      keyword_literal_warnings value_expr
  | Ast.List
      (_, Ast.Symbol (_, ("__schema" | "__service" | "__error")) :: _)
    ->
      []
  | Ast.List
      (_, Ast.Symbol (_, ("define" | "def")) :: Ast.List (_, _head) :: body)
    when body <> [] ->
      recurse body
  | Ast.List (_, exprs) | Ast.Vector (_, exprs) -> recurse exprs
  | Ast.Map (_, entries) ->
      entries
      |> List.concat_map (fun (_key, value) -> keyword_literal_warnings value)
  | Ast.Nil _ | Ast.Bool _ | Ast.Int _ | Ast.Float _ | Ast.String _
  | Ast.Symbol _ | Ast.Keyword _ ->
      []

let type_projection_json display =
  let named =
    match display with
    | "Int" | "Number" | "Bool" | "String" | "Unit" | "Keyword"
    | "Symbol" | "Syntax" | "Any" | "Map" | "List" | "Vector" | "Declaration" ->
        true
    | _ -> false
  in
  if named then
    let name = display in
    Printf.sprintf "{\"kind\":\"named\",\"name\":%s,\"display\":%s}"
      (Value.string_json name)
      (Value.string_json display)
  else
    Printf.sprintf "{\"kind\":\"display\",\"display\":%s}"
      (Value.string_json display)

let expression_type_json (item : Typecheck.expression_type) =
  let display = Type_expr.ty_to_string item.typ in
  Printf.sprintf
    "{\"expressionId\":%s,\"formIndex\":%d,\"span\":%s,\"display\":%s,\"type\":%s}"
    (Value.string_json
       (Printf.sprintf "%s:%d" item.span.Ast.source_id item.form_index))
    item.form_index
    (Cst.span_to_json item.span)
    (Value.string_json display)
    (Type_expr.to_json item.typ)

let success_json ?(expression_types = []) request ty exprs extra_diagnostics =
  let diagnostics = exprs |> List.concat_map keyword_literal_warnings in
  let diagnostics_json = String.concat "," (diagnostics @ extra_diagnostics) in
  let projection =
    match request.Abi_request.result with
    | Some "per-expression" ->
        Printf.sprintf ",\"expressionTypes\":[%s]"
          (String.concat "," (List.map expression_type_json expression_types))
    | _ -> ""
  in
  Printf.sprintf
    "{\"ok\":true,\"type\":\"%s\",\"diagnostics\":[%s],\"value\":{\"result\":\"%s\",\"type\":%s,\"display\":\"%s\",\"diagnostics\":[%s]%s}}"
    (Abi_response.json_escape ty)
    diagnostics_json
    (match request.Abi_request.result with
    | Some result -> Abi_response.json_escape result
    | None -> "summary")
    (type_projection_json ty)
    (Abi_response.json_escape ty)
    diagnostics_json projection
