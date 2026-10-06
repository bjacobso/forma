type diagnostic = Lower_common.diagnostic = {
  span : Ast.span option;
  code : string;
  message : string;
}

let diagnostic = Lower_common.diagnostic

let binding expr name value =
  Core_ast.{ node = Core_ast.node (Ast.expr_span expr); name; expr = value }

let effect_marker_value = function
  | Ast.List (_, [ Ast.Symbol (_, "<-"); value ]) -> Some value
  | _ -> None

let rec bindings_contain_effect_marker = function
  | [] -> false
  | _name :: value :: rest -> (
      match effect_marker_value value with
      | Some _ -> true
      | None -> bindings_contain_effect_marker rest)
  | _ -> false

let rec lower_bindings lower_expr acc = function
  | [] -> Ok (List.rev acc)
  | Ast.Symbol (_, name) :: value_expr :: rest -> (
      match lower_expr value_expr with
      | Error _ as error -> error
      | Ok value -> lower_bindings lower_expr (binding value_expr name value :: acc) rest)
  | bad :: _ ->
      Error
        [
          diagnostic ~span:(Ast.expr_span bad) "lower/do-effect"
            "do! binding name must be a symbol.";
        ]

let rec lower_body lower_expr span = function
  | [] -> Ok (Core_ast.Lit (Core_ast.node span, Core_ast.LNil))
  | [ expr ] -> (
      match effect_marker_value expr with
      | Some effect_expr -> (
          let name = "__effect_bind_0" in
          match lower_expr effect_expr with
          | Error _ as error -> error
          | Ok effect_value ->
              Ok
                (Core_ast.EffectDo
                   ( Core_ast.node span,
                     [ binding expr name effect_value ],
                     Core_ast.Var (Core_ast.node (Ast.expr_span expr), name) )))
      | None -> lower_expr expr)
  | expr :: rest -> (
      match effect_marker_value expr with
      | Some effect_expr -> (
          match (lower_expr effect_expr, lower_body lower_expr span rest) with
          | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics
          | Ok effect_value, Ok body ->
              let name =
                Printf.sprintf "__effect_bind_%d" (List.length rest)
              in
              Ok
                (Core_ast.EffectDo
                   (Core_ast.node span, [ binding expr name effect_value ], body)))
      | None -> (
          match lower_expr expr with
          | Error _ as error -> error
          | Ok value ->
              let name = Printf.sprintf "__do_%d" (List.length rest) in
              Result.map
                (fun body ->
                  Core_ast.Let (Core_ast.node span, [ binding expr name value ], body))
                (lower_body lower_expr span rest)))

let rec lower_sequence lower_expr expr args =
  match args with
  | Ast.Vector (_, bindings) :: body when body <> [] -> (
      let rec split prefix = function
        | Ast.Keyword (span,":let") :: Ast.Vector (bs,pure) :: rest ->
            if List.length pure mod 2<>0 then Error [diagnostic ~span "lower/do-effect" ":let requires binding/value pairs."] else
            let remaining=Ast.List (span,Ast.Symbol (span,"do!") :: Ast.Vector (bs,rest) :: body) in
            let scoped=Ast.List (span,[Ast.Symbol (span,"let");Ast.Vector (bs,pure);remaining]) in
            lower_sequence lower_expr expr [Ast.Vector (bs,List.rev prefix);scoped]
        | key :: value :: rest -> split (value :: key :: prefix) rest
        | [] ->
      (match (lower_bindings lower_expr [] bindings, lower_body lower_expr (Ast.expr_span expr) body) with
      | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics
      | Ok bindings, Ok body -> Ok (Core_ast.EffectDo (Core_ast.node (Ast.expr_span expr), bindings, body)))
        | _ -> Error [diagnostic "lower/do-effect" "do! requires binding/value pairs."] in
      split [] bindings
      )
  | _ ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "lower/do-effect"
            "do! expects a binding vector and one or more body forms.";
        ]

let lower_fail lower_expr expr = function
  | [ Ast.List (_, [ Ast.Symbol (_, error_name); payload ]) ] -> (
      match lower_expr payload with
      | Error _ as error -> error
      | Ok payload ->
          Ok
            (Core_ast.EffectFail
               (Core_ast.node (Ast.expr_span expr), error_name, payload)))
  | _ ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "lower/effect-fail"
            "fail expects a constructed error value: (fail (ErrorName payload)).";
        ]

let lower_catch lower_expr expr = function
  | [ body; Ast.List (_, [ Ast.Symbol (_, error_name); Ast.Symbol (binding_span, binding_name) ]); handler ] -> (
      match (lower_expr body, lower_expr handler) with
      | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics
      | Ok body, Ok handler ->
          Ok
            (Core_ast.EffectCatch
               ( Core_ast.node (Ast.expr_span expr),
                 body,
                 error_name,
                 Core_ast.{ node = Core_ast.node binding_span; name = binding_name },
                 handler )))
  | _ ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "lower/effect-catch"
            "catch expects (catch effect (ErrorName binding) handler).";
        ]

let lower_let lower_expr lower_body expr bindings body =
  let rec loop = function
    | [] -> lower_body (Ast.expr_span expr) body
    | name_expr :: value_expr :: rest -> (
        match effect_marker_value value_expr with
        | Some effect_expr -> (
            match name_expr with
            | Ast.Symbol (_, name) -> (
                match (lower_expr effect_expr, loop rest) with
                | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics
                | Ok effect_value, Ok body ->
                    Ok
                      (Core_ast.EffectDo
                         ( Core_ast.node (Ast.expr_span expr),
                           [ binding name_expr name effect_value ],
                           body )))
            | _ ->
                Error
                  [
                    diagnostic ~span:(Ast.expr_span name_expr)
                      "lower/effect-let"
                      "<- let binding name must be a symbol.";
                  ])
        | None -> (
            match name_expr with
            | Ast.Symbol (_, name) -> (
                match (lower_expr value_expr, loop rest) with
                | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics
                | Ok value, Ok body ->
                    Ok
                      (Core_ast.Let
                         ( Core_ast.node (Ast.expr_span expr),
                           [ binding name_expr name value ],
                           body )))
            | _ ->
                Error
                  [
                    diagnostic ~span:(Ast.expr_span name_expr)
                      "lower/effect-let"
                      "let bindings that contain <- currently require symbolic \
                       names.";
                  ]))
    | _ ->
        Error
          [
            diagnostic "lower/effect-let"
              "let bindings must contain even symbol/value pairs.";
          ]
  in
  loop bindings
