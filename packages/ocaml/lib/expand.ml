type diagnostic = { span : Ast.span option; code : string; message : string }
type eval_body = Env.t -> Ast.expr list -> (Value.t, diagnostic list) result

let diagnostic ?span code message = { span; code; message }

let with_span span diagnostics =
  List.map
    (fun diagnostic ->
      match diagnostic.span with
      | Some _ -> diagnostic
      | None -> { diagnostic with span = Some span })
    diagnostics

let quote_diagnostics diagnostics =
  List.map
    (fun (quote_diagnostic : Quote.diagnostic) ->
      diagnostic quote_diagnostic.Quote.code quote_diagnostic.message)
    diagnostics

let diagnostic_to_json diagnostic =
  match diagnostic.span with
  | Some span ->
      Diagnostic.to_json
        (Diagnostic.error ~span ~code:diagnostic.code
           ~message:diagnostic.message ())
  | None ->
      Printf.sprintf
        "{\"span\":null,\"severity\":\"error\",\"code\":%s,\"message\":%s,\"notes\":[],\"fixes\":[]}"
        (Value.string_json diagnostic.code)
        (Value.string_json diagnostic.message)

let rec map_result f acc = function
  | [] -> Ok (List.rev acc)
  | item :: rest -> (
      match f item with
      | Error _ as error -> error
      | Ok value -> map_result f (value :: acc) rest)

let parse_params params =
  let rec loop acc = function
    | [] -> Ok (List.rev acc, None)
    | [ Ast.Symbol (_, "&"); Ast.Symbol (_, name) ] ->
        Ok (List.rev acc, Some name)
    | Ast.Symbol (_, "&") :: _ ->
        Error
          [
            diagnostic "expand/macro-params"
              "& must be followed by exactly one rest parameter symbol.";
          ]
    | Ast.Symbol (_, name) :: rest -> loop (name :: acc) rest
    | param :: _ ->
        Error
          [
            diagnostic "expand/macro-params"
              (Printf.sprintf "Macro parameters must be symbols, got %s."
                 (Ast.expr_to_json param));
          ]
  in
  loop [] params

let apply_macro ~eval_body closure args =
  let required = List.length closure.Value.params in
  if
    match closure.rest_param with
    | None -> List.length args <> required
    | Some _ -> List.length args < required
  then
    Error
      [
        diagnostic "expand/arity"
          (Printf.sprintf "Macro expects %s%d arguments, received %d."
             (if Option.is_some closure.rest_param then "at least " else "")
             required (List.length args));
      ]
  else
    let syntax_args = List.map Quote.value_of_syntax args in
    let rec take n acc values =
      if n = 0 then (List.rev acc, values)
      else
        match values with
        | [] -> (List.rev acc, [])
        | value :: rest -> take (n - 1) (value :: acc) rest
    in
    let required_values, rest_values = take required [] syntax_args in
    let rest_binding =
      match closure.rest_param with
      | None -> []
      | Some name -> [ (name, Value.VList rest_values) ]
    in
    let local_env =
      Env.extend
        (List.combine closure.params required_values @ rest_binding)
        (Env.of_bindings closure.env)
    in
    match eval_body local_env closure.body with
    | Error _ as error -> error
    | Ok value ->
        Quote.syntax_of_value value |> Result.map_error quote_diagnostics

let rec replace_generated_spans span = function
  | Ast.Nil expr_span when expr_span.source_id = "generated" -> Ast.Nil span
  | Ast.Bool (expr_span, value) when expr_span.source_id = "generated" ->
      Ast.Bool (span, value)
  | Ast.Int (expr_span, value) when expr_span.source_id = "generated" ->
      Ast.Int (span, value)
  | Ast.Float (expr_span, value) when expr_span.source_id = "generated" ->
      Ast.Float (span, value)
  | Ast.String (expr_span, value) when expr_span.source_id = "generated" ->
      Ast.String (span, value)
  | Ast.Symbol (expr_span, value) when expr_span.source_id = "generated" ->
      Ast.Symbol (span, value)
  | Ast.Keyword (expr_span, value) when expr_span.source_id = "generated" ->
      Ast.Keyword (span, value)
  | Ast.List (expr_span, items) when expr_span.source_id = "generated" ->
      Ast.List (span, List.map (replace_generated_spans span) items)
  | Ast.Vector (expr_span, items) when expr_span.source_id = "generated" ->
      Ast.Vector (span, List.map (replace_generated_spans span) items)
  | Ast.Map (expr_span, entries) when expr_span.source_id = "generated" ->
      Ast.Map
        ( span,
          List.map
            (fun (key, value) ->
              ( replace_generated_spans span key,
                replace_generated_spans span value ))
            entries )
  | expr -> expr

let rec expand_expr ~eval_body env expr =
  let result =
    match expr with
    | Ast.Nil _ | Ast.Bool _ | Ast.Int _ | Ast.Float _ | Ast.String _
    | Ast.Symbol _ | Ast.Keyword _ ->
        Ok expr
    | Ast.Vector (span, items) ->
        map_result (expand_expr ~eval_body env) [] items
        |> Result.map (fun items -> Ast.Vector (span, items))
    | Ast.Map (span, entries) ->
        let expand_entry (key, value) =
          match
            (expand_expr ~eval_body env key, expand_expr ~eval_body env value)
          with
          | Ok key, Ok value -> Ok (key, value)
          | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics
        in
        map_result expand_entry [] entries
        |> Result.map (fun entries -> Ast.Map (span, entries))
    | Ast.List (_, []) -> Ok expr
    | Ast.List (_, Ast.Symbol (_, "quote") :: _) -> Ok expr
    | Ast.List (_, Ast.Symbol (_, "quasiquote") :: _) -> Ok expr
    | Ast.List (_, Ast.Symbol (_, op) :: _) when Env.lookup ("__form/" ^ op) env <> None ->
        (* Form holes are authored syntax. Their declared checks expand expressions
           separately; projection must retain the original, stable syntax. *)
        Ok expr
    | Ast.List (span, Ast.Symbol (op_span, op) :: args) -> (
        match Env.lookup op env with
        | Some (Value.VMacro closure) -> (
            match apply_macro ~eval_body closure args with
            | Error _ as error -> error
            | Ok expanded ->
                expand_expr ~eval_body env
                  (replace_generated_spans span expanded))
        | _ ->
            map_result (expand_expr ~eval_body env) [] args
            |> Result.map (fun args ->
                Ast.List (span, Ast.Symbol (op_span, op) :: args)))
    | Ast.List (span, callee :: args) -> (
        match
          ( expand_expr ~eval_body env callee,
            map_result (expand_expr ~eval_body env) [] args )
        with
        | Ok callee, Ok args -> Ok (Ast.List (span, callee :: args))
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
  in
  Result.map_error (with_span (Ast.expr_span expr)) result

let expand_toplevel ~eval_body env expr =
  match expr with
  | Ast.List
      ( _,
        Ast.Symbol (_, ("defmacro" | "__macro"))
        :: Ast.Symbol (_, name)
        :: Ast.Vector (_, params)
        :: body ) -> (
      match parse_params params with
      | Error _ as error -> error
      | Ok (params, rest_param) ->
          let value =
            Value.VMacro { params; rest_param; body; env = Env.bindings env }
          in
          Ok (expr, Env.bind name value env))
  | Ast.List (_, Ast.Symbol (_, ("defmacro" | "__macro")) :: _) as
    macro_form -> (
      match expand_expr ~eval_body env macro_form with
      | Error _ as error -> error
      | Ok _ ->
          Error
            [
              diagnostic ~span:(Ast.expr_span macro_form)
                "expand/define-macro-form"
                "__macro expects a symbol name, parameter vector, and \
                 body forms.";
            ])
  | _ -> (
      match expand_expr ~eval_body env expr with
      | Error _ as error -> error
      | Ok expr -> Ok (expr, env))

let expand_program ~eval_body env exprs =
  let rec loop env acc = function
    | [] -> Ok (List.rev acc, env)
    | expr :: rest -> (
        match expand_toplevel ~eval_body env expr with
        | Error _ as error -> error
        | Ok (expr, env) -> loop env (expr :: acc) rest)
  in
  let known_actions=Env.visible_bindings env |> List.filter_map (fun (n,value) ->
    if Descriptor.declaration_form value=Some "__action" then Some n else None) in
  try loop env [] (Surface.core_program (Surface_protocol.program (Surface_form.program (Surface_action.program ~known_actions exprs)))) with
  | exn -> (
      match Surface.diagnostic_of_exn exn with
      | Some (span, code, message) -> Error [diagnostic ~span code message]
      | None -> raise exn)
