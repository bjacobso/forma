type diagnostic = Lower_common.diagnostic = {
  span : Ast.span option;
  code : string;
  message : string;
}

open Core_ast

let diagnostic = Lower_common.diagnostic
let diagnostic_to_json = Lower_common.diagnostic_to_json
let mk_node expr = Core_ast.node (Ast.expr_span expr)
let mk_param expr name = Core_ast.{ node = mk_node expr; name }

let mk_binding expr name value =
  Core_ast.{ node = mk_node expr; name; expr = value }

let mk_field expr label value = Core_ast.{ node = mk_node expr; label; value }

let label_name = function
  | Ast.Symbol (_, name) | Ast.Keyword (_, name) -> Some name
  | Ast.String (_,name) -> Some (if String.starts_with ~prefix:":" name || String.starts_with ~prefix:"\000" name then "\000str:" ^ name else name)
  | _ -> None

let is_else = function
  | Ast.Symbol (_, "else") | Ast.Keyword (_, ":else") -> true
  | _ -> false

let fresh_binding_counter = ref 0

let fresh_internal_binding prefix =
  incr fresh_binding_counter;
  Printf.sprintf "__%s_%d" prefix !fresh_binding_counter

let mk_core_var span name = Core_ast.Var (Core_ast.node span, name)

let mk_core_app span callee args =
  Core_ast.App (Core_ast.node span, callee, args)

let mk_core_int span value =
  Core_ast.Lit (Core_ast.node span, Core_ast.LInt value)

let symbol_like_name = function
  | Ast.Symbol (_, name) | Ast.Keyword (_, name) | Ast.String (_, name) ->
      Some name
  | _ -> None

let rec lower_destructure_pattern span pattern value_expr acc =
  match pattern with
  | Ast.Symbol (_, name) -> Ok (mk_binding pattern name value_expr :: acc)
  | Ast.Map (_, entries) ->
      let placeholder = fresh_internal_binding "destructure_map" in
      let acc = mk_binding pattern placeholder value_expr :: acc in
      lower_map_destructure span entries
        (mk_core_var (Ast.expr_span pattern) placeholder)
        acc
  | Ast.Vector (_, items) ->
      let placeholder = fresh_internal_binding "destructure_seq" in
      let acc = mk_binding pattern placeholder value_expr :: acc in
      lower_seq_destructure span items
        (mk_core_var (Ast.expr_span pattern) placeholder)
        acc
  | _ -> Ok acc

and lower_map_destructure span entries source_expr acc =
  let rec loop acc = function
    | [] -> Ok acc
    | (key, value) :: rest -> (
        match (symbol_like_name key, value) with
        | Some ":keys", Ast.Vector (_, items) ->
            let rec lower_keys acc = function
              | [] -> loop acc rest
              | key :: more -> (
                  match key with
                  | Ast.Symbol (_, name) -> (
                      let get_expr =
                        Core_ast.Get
                          (Core_ast.node span, source_expr, ":" ^ name)
                      in
                      match lower_destructure_pattern span key get_expr acc with
                      | Error _ as error -> error
                      | Ok acc -> lower_keys acc more)
                  | _ -> lower_keys acc more)
            in
            lower_keys acc items
        | Some ":as", Ast.Symbol (_, name) ->
            loop (mk_binding value name source_expr :: acc) rest
        | _ -> (
            match label_name key with
            | None -> loop acc rest
            | Some label -> (
                let get_expr =
                  Core_ast.Get (Core_ast.node span, source_expr, label)
                in
                match lower_destructure_pattern span value get_expr acc with
                | Error _ as error -> error
                | Ok acc -> loop acc rest)))
  in
  loop acc entries

and lower_seq_destructure span items source_expr acc =
  let rec loop index acc = function
    | [] -> Ok acc
    | Ast.Symbol (_, "&") :: rest -> (
        match rest with
        | [ pattern ] ->
            let rec build_rest expr remaining =
              if remaining <= 0 then expr
              else
                build_rest
                  (mk_core_app span (mk_core_var span "rest") [ expr ])
                  (remaining - 1)
            in
            lower_destructure_pattern span pattern
              (build_rest source_expr index)
              acc
        | _ ->
            Error
              [
                diagnostic "lower/lambda-params"
                  "& must be followed by exactly one rest parameter.";
              ])
    | item :: rest -> (
        let nth_expr =
          mk_core_app span (mk_core_var span "nth")
            [ source_expr; mk_core_int span index ]
        in
        match lower_destructure_pattern span item nth_expr acc with
        | Error _ as error -> error
        | Ok acc -> loop (index + 1) acc rest)
  in
  loop 0 acc items

let rec lower_expr expr =
  match expr with
  | Ast.Nil _ -> Ok (Core_ast.Lit (mk_node expr, LNil))
  | Ast.Bool (_, value) -> Ok (Core_ast.Lit (mk_node expr, LBool value))
  | Ast.Int (_, value) -> Ok (Core_ast.Lit (mk_node expr, LInt value))
  | Ast.Float (_, value) -> Ok (Core_ast.Lit (mk_node expr, LFloat value))
  | Ast.String (_, value) -> Ok (Core_ast.Lit (mk_node expr, LString value))
  | Ast.Keyword (_, value) -> Ok (Core_ast.Lit (mk_node expr, LKeyword value))
  | Ast.Symbol (_, name) -> Ok (Core_ast.Var (mk_node expr, name))
  | Ast.Vector (span, items) ->
      lower_application expr (Ast.Symbol (span, "__vector")) items
  | Ast.Map (_, entries) -> lower_record expr entries
  | Ast.List (_, []) -> Ok (Core_ast.Lit (mk_node expr, LNil))
  | Ast.List (_, Ast.Symbol (_, op) :: args)
  | Ast.List (_, Ast.Keyword (_, op) :: args) ->
      lower_form expr op args
  | Ast.List (_, callee :: args) -> lower_application expr callee args

and lower_form expr op args =
  match op with
  | "quote" -> (match args with
      | [Ast.Symbol (_,n)] -> Ok (Core_ast.Lit (mk_node expr, LSymbol n))
      | [(Ast.List _ | Ast.Vector _ | Ast.Map _) as value] -> Ok (Core_ast.Lit (mk_node expr, LQuoted value))
      | [value] -> lower_expr value
      | _ -> Error [diagnostic ~span:(Ast.expr_span expr) "lower/quote" "quote expects one datum"])

  | "fn" | "lambda" -> lower_lambda expr args
  | "let" -> lower_let expr args
  | "define" | "def" -> lower_define expr args
  | "defn" | "__operation" -> lower_defn expr args
  | "if" -> lower_if expr args
  | "when" -> lower_when expr args
  | "unless" -> lower_unless expr args
  | "cond" -> lower_cond expr args
  | "and" -> lower_and expr args
  | "do" -> lower_sequence (Ast.expr_span expr) args
  | "do!" -> Lower_effect.lower_sequence lower_expr expr args
  | "fail" -> Lower_effect.lower_fail lower_expr expr args
  | "catch" -> Lower_effect.lower_catch lower_expr expr args
  | "get" -> lower_get expr args
  | ":" -> lower_ascribe expr args
  | "match" -> Lower_match.lower_match lower_expr expr args
  | "__sum-type" -> lower_type_def expr args
  | "define-effect" | "perform" | "handle" | "->!" ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "lower/legacy-effect"
            "Legacy algebraic effect forms are not supported; use __service, __operation, and Effect.";
        ]
  | _ -> lower_application expr (Ast.Symbol (Ast.expr_span expr, op)) args

and lower_exprs exprs =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | expr :: rest -> (
        match lower_expr expr with
        | Error _ as error -> error
        | Ok lowered -> loop (lowered :: acc) rest)
  in
  loop [] exprs

and lower_application expr callee args =
  match lower_expr callee with
  | Error _ as error -> error
  | Ok callee -> (
      match lower_exprs args with
      | Error _ as error -> error
      | Ok args -> Ok (Core_ast.App (mk_node expr, callee, args)))

and lower_record expr entries =
  let rec loop acc = function
    | [] -> Ok (Core_ast.Record (mk_node expr, List.rev acc))
    | (key, value) :: rest -> (
        match label_name key with
        | None ->
            Error
              [
                diagnostic ~span:(Ast.expr_span key) "lower/record-field"
                  "Record field names must be symbols, keywords, or strings.";
              ]
        | Some label -> (
            match lower_expr value with
            | Error _ as error -> error
            | Ok lowered -> loop (mk_field key label lowered :: acc) rest))
  in
  loop [] entries

and lower_lambda expr args =
  match args with
  | Ast.Vector (_, params) :: body when body <> [] -> (
      match lower_params [] [] params with
      | Error _ as error -> error
      | Ok (params, rest_param, destructure_bindings) -> (
          match lower_sequence (Ast.expr_span expr) body with
          | Error _ as error -> error
          | Ok body ->
              let body =
                match destructure_bindings with
                | [] -> body
                | bindings ->
                    Core_ast.Let
                      ( Core_ast.node (Ast.expr_span expr),
                        List.rev bindings,
                        body )
              in
              Ok (Core_ast.Lam (mk_node expr, params, rest_param, body))))
  | _ ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "lower/lambda"
            "fn expects a parameter vector and one or more body forms.";
        ]

and lower_params acc destructure_bindings = function
  | [] -> Ok (List.rev acc, None, destructure_bindings)
  | [ Ast.Symbol (_, "&"); (Ast.Symbol (_, name) as rest_expr) ] ->
      Ok (List.rev acc, Some (mk_param rest_expr name), destructure_bindings)
  | Ast.Symbol (_, "&") :: _ ->
      Error
        [
          diagnostic "lower/lambda-params"
            "& must be followed by exactly one rest parameter.";
        ]
  | (Ast.Symbol (_, name) as expr) :: rest ->
      lower_params (mk_param expr name :: acc) destructure_bindings rest
  | ((Ast.Map _ | Ast.Vector _) as pattern) :: rest -> (
      let placeholder = fresh_internal_binding "destructure" in
      let acc = mk_param pattern placeholder :: acc in
      let placeholder_expr = mk_core_var (Ast.expr_span pattern) placeholder in
      match
        lower_destructure_pattern (Ast.expr_span pattern) pattern
          placeholder_expr destructure_bindings
      with
      | Error _ as error -> error
      | Ok destructure_bindings -> lower_params acc destructure_bindings rest)
  | bad :: _ ->
      Error
        [
          diagnostic ~span:(Ast.expr_span bad) "lower/lambda-params"
            "fn param must be a symbol, map destructure, or vector destructure.";
        ]

and lower_let expr args =
  match args with
  | Ast.Vector (_, bindings) :: body when body <> [] -> (
      if Lower_effect.bindings_contain_effect_marker bindings then
        Lower_effect.lower_let lower_expr lower_sequence expr bindings body
      else
      match lower_bindings [] bindings with
      | Error _ as error -> error
      | Ok bindings -> (
          match lower_sequence (Ast.expr_span expr) body with
          | Error _ as error -> error
          | Ok body -> Ok (Core_ast.Let (mk_node expr, bindings, body))))
  | _ ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "lower/let"
            "let expects a binding vector and one or more body forms.";
        ]

and lower_bindings acc = function
  | [] -> Ok (List.rev acc)
  | name_expr :: value_expr :: rest -> (
      match lower_expr value_expr with
      | Error _ as error -> error
      | Ok value -> (
          match name_expr with
          | Ast.Symbol (_, name) ->
              lower_bindings (mk_binding name_expr name value :: acc) rest
          | (Ast.Map _ | Ast.Vector _) as pattern -> (
              let placeholder = fresh_internal_binding "destructure_let" in
              let placeholder_expr =
                mk_core_var (Ast.expr_span pattern) placeholder
              in
              let acc = mk_binding pattern placeholder value :: acc in
              match
                lower_destructure_pattern (Ast.expr_span pattern) pattern
                  placeholder_expr acc
              with
              | Error _ as error -> error
              | Ok acc -> lower_bindings acc rest)
          | _ ->
              Error
                [
                  diagnostic ~span:(Ast.expr_span name_expr)
                    "lower/let-bindings"
                    "let binding name must be a symbol, map destructure, or \
                     vector destructure";
                ]))
  | _ ->
      Error
        [
          diagnostic "lower/let-bindings"
            "let bindings must contain even symbol/value pairs.";
        ]

and lower_define expr args =
  match args with
  | [ Ast.Symbol (_, name); value_expr ] -> (
      match lower_expr value_expr with
      | Error _ as error -> error
      | Ok value -> Ok (Core_ast.Def (mk_node expr, name, None, value)))
  | Ast.List (_, Ast.Symbol (_, name) :: params) :: body when body <> [] ->
      lower_function_def expr name params body
  | _ ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "lower/define"
            "define expects a symbol/value pair or function head and body.";
        ]

and lower_defn expr args =
  match args with
  | Ast.Symbol (_, name) :: Ast.Vector (_, params) :: body when body <> [] ->
      lower_function_def expr name params body
  | _ ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "lower/defn"
            "defn expects a symbol name, parameter vector, and one or more \
             body forms.";
        ]

and lower_function_def expr name params body =
  let lambda_form =
    Ast.List
      ( Ast.expr_span expr,
        Ast.Symbol (Ast.expr_span expr, "fn")
        :: Ast.Vector (Ast.expr_span expr, params)
        :: body )
  in
  match lower_expr lambda_form with
  | Error _ as error -> error
  | Ok value -> Ok (Core_ast.Def (mk_node expr, name, None, value))

and lower_if expr args =
  match args with
  | [ condition; consequent ] -> (
      match (lower_expr condition, lower_expr consequent) with
      | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics
      | Ok condition, Ok consequent ->
          Ok
            (Core_ast.If
               ( mk_node expr,
                 condition,
                 consequent,
                 Core_ast.Lit (Core_ast.node (Ast.expr_span expr), LNil) )))
  | [ condition; consequent; alternate ] -> (
      match
        (lower_expr condition, lower_expr consequent, lower_expr alternate)
      with
      | Error diagnostics, _, _
      | _, Error diagnostics, _
      | _, _, Error diagnostics ->
          Error diagnostics
      | Ok condition, Ok consequent, Ok alternate ->
          Ok (Core_ast.If (mk_node expr, condition, consequent, alternate)))
  | _ ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "lower/if"
            "if expects a condition, consequent, and optional alternate.";
        ]

and lower_when expr args =
  match args with
  | condition :: body -> (
      match
        (lower_expr condition, lower_sequence (Ast.expr_span expr) body)
      with
      | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics
      | Ok condition, Ok consequent ->
          Ok
            (Core_ast.If
               ( mk_node expr,
                 condition,
                 consequent,
                 Core_ast.Lit (Core_ast.node (Ast.expr_span expr), LNil) )))
  | [] ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "lower/when"
            "when expects a condition and zero or more body forms.";
        ]

and lower_unless expr args =
  match args with
  | condition :: body -> (
      match
        (lower_expr condition, lower_sequence (Ast.expr_span expr) body)
      with
      | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics
      | Ok condition, Ok alternate ->
          let nil = Core_ast.Lit (Core_ast.node (Ast.expr_span expr), LNil) in
          Ok (Core_ast.If (mk_node expr, condition, nil, alternate)))
  | [] ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "lower/unless"
            "unless expects a condition and zero or more body forms.";
        ]

and lower_cond expr args =
  let nil = Core_ast.Lit (Core_ast.node (Ast.expr_span expr), LNil) in
  let rec loop = function
    | [] -> Ok nil
    | [ _ ] ->
        Error
          [
            diagnostic ~span:(Ast.expr_span expr) "lower/cond"
              "cond expects test/expression pairs.";
          ]
    | test :: branch :: rest when is_else test -> (
        match rest with
        | [] -> lower_expr branch
        | _ ->
            Error
              [
                diagnostic ~span:(Ast.expr_span test) "lower/cond"
                  "cond :else clause must be last.";
              ])
    | test :: branch :: rest -> (
        match (lower_expr test, lower_expr branch, loop rest) with
        | Error diagnostics, _, _
        | _, Error diagnostics, _
        | _, _, Error diagnostics ->
            Error diagnostics
        | Ok test, Ok branch, Ok alternate ->
            Ok (Core_ast.If (mk_node expr, test, branch, alternate)))
  in
  loop args

and lower_and expr args =
  let nil = Core_ast.Lit (Core_ast.node (Ast.expr_span expr), LNil) in
  let rec loop = function
    | [] -> Ok (Core_ast.Lit (Core_ast.node (Ast.expr_span expr), LBool true))
    | [ last ] -> lower_expr last
    | condition :: rest -> (
        match (lower_expr condition, loop rest) with
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics
        | Ok condition, Ok consequent ->
            Ok (Core_ast.If (mk_node expr, condition, consequent, nil)))
  in
  loop args
and lower_sequence span exprs = Lower_effect.lower_body lower_expr span exprs
and lower_get expr args =
  match args with
  | [record_expr; ((Ast.Keyword _ | Ast.String _) as label_expr)] -> (
      match (lower_expr record_expr, label_name label_expr) with
      | Error diagnostics, _ -> Error diagnostics
      | _, None ->
          Error
            [
              diagnostic ~span:(Ast.expr_span label_expr) "lower/get"
                "get label must be a symbol, keyword, or string.";
            ]
      | Ok record, Some label -> Ok (Core_ast.Get (mk_node expr, record, label))
      )
  | [record;key] -> lower_application expr (Ast.Symbol (Ast.expr_span expr,"get")) [record;key]
  | _ ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "lower/get"
            "get expects a record expression and label.";
        ]
and lower_ascribe expr args =
  match args with
  | [ value_expr; type_expr ] -> (
      match (lower_expr value_expr, Lower_type.parse_type_expr type_expr) with
      | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics
      | Ok value, Ok typ -> Ok (Core_ast.Ascribe (mk_node expr, value, typ)))
  | _ ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "lower/ascription"
            "(: expr Type) expects an expression and a type.";
        ]
and lower_type_def expr args =
  match args with
  | [ Ast.Symbol (_, name); type_expr ] -> (
      match Lower_type.parse_type_expr type_expr with
      | Error _ as error -> error
      | Ok typ -> Ok (Core_ast.TypeDef (mk_node expr, name, Some typ)))
  | [ Ast.Symbol (_, name) ] -> Ok (Core_ast.TypeDef (mk_node expr, name, None))
  | _ ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "lower/type-definition"
            "__sum-type expects a name and optional type expression.";
        ]
let program exprs =
  Core_ast.reset_node_ids ();
  let signatures = List.filter_map (fun e -> Option.map (fun (n,t) -> n,(e,t)) (Lower_type.type_signature e)) exprs in
  let definitions = List.filter_map Lower_type.definition_name exprs in
  let duplicate = List.find_opt (fun (n,_) -> List.length (List.filter (fun (m,_) -> n=m) signatures) > 1) signatures in
  match duplicate with
  | Some (_, (e,_)) -> Error [diagnostic ~span:(Ast.expr_span e) "lower/signature" "Duplicate module signature."]
  | None ->
      let missing = List.find_opt (fun (n,_) -> not (List.mem n definitions)) signatures in
      match missing with
      | Some (n,(e,_)) -> Error [diagnostic ~span:(Ast.expr_span e) "lower/signature" ("No definition for signature " ^ n)]
      | None ->
          let rec loop acc = function
            | [] -> Ok (List.rev acc)
            | e :: rest when Option.is_some (Lower_type.type_signature e) -> loop acc rest
            | e :: rest -> (match lower_expr e with
              | Error _ as error -> error
              | Ok lowered ->
                  let signature = Option.bind (Lower_type.definition_name e) (fun n -> List.assoc_opt n signatures) in
                  match signature with
                  | None -> loop (lowered :: acc) rest
                  | Some (_,t) -> (match Lower_type.parse_type_expr t with
                    | Error _ as error -> error
                    | Ok signature -> match Lower_type.attach_signature signature lowered with
                      | Error _ as error -> error | Ok lowered -> loop (lowered :: acc) rest))
          in loop [] exprs
