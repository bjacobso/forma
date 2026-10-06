type diagnostic = Lower_common.diagnostic = {
  span : Ast.span option;
  code : string;
  message : string;
}

let diagnostic = Lower_common.diagnostic

let label_name = function
  | Ast.Symbol (_, name) | Ast.Keyword (_, name) -> Some name
  | Ast.String (_,name) -> Some (if String.starts_with ~prefix:":" name || String.starts_with ~prefix:"\000" name then "\000str:" ^ name else name)
  | _ -> None

let rec parse_type_expr expr =
  match expr with
  | Ast.List (s, [Ast.Symbol (h,"Effect"); success]) -> parse_type_expr (Ast.List (s,[Ast.Symbol (h,"Effect");success;Ast.Vector (s,[]);Ast.Vector (s,[])]))
  | Ast.List (s, [Ast.Symbol (h,"Effect"); success; errors]) -> parse_type_expr (Ast.List (s,[Ast.Symbol (h,"Effect");success;errors;Ast.Vector (s,[])]))
  | Ast.String (span,v) -> Ok (Core_ast.TESym (span,Value.string_json v))
  | Ast.Int (span,v) -> Ok (Core_ast.TESym (span,string_of_int v))
  | Ast.Float (span,v) -> Ok (Core_ast.TESym (span,string_of_float v))
  | Ast.Bool (span,v) -> Ok (Core_ast.TESym (span,string_of_bool v))
  | Ast.Symbol (span, name) -> Ok (Core_ast.TESym (span, name))
  | Ast.Keyword (span, name) -> Ok (Core_ast.TESym (span, name))
  | Ast.List
      ( span,
        [
          Ast.Symbol (head_span, "Effect");
          success_expr;
          errors_expr;
          requirements_expr;
        ] ) -> (
      match
        ( parse_type_expr success_expr,
          parse_effect_type_set "ErrorSet" errors_expr,
          parse_effect_type_set "RequirementSet" requirements_expr )
      with
      | Error diagnostics, _, _
      | _, Error diagnostics, _
      | _, _, Error diagnostics ->
          Error diagnostics
      | Ok success, Ok errors, Ok requirements ->
          Ok
            (Core_ast.TEApp
               ( span,
                 Core_ast.TESym (head_span, "Effect"),
                 [ success; errors; requirements ] )))
  | Ast.List (span, Ast.Symbol (_, "Effect") :: _) ->
      Error
        [
          diagnostic ~span "lower/type-expression"
            "Effect type requires exactly success, errors, and requirements \
             arguments.";
        ]
  | Ast.List (span, Ast.Symbol (_, "->") :: items) -> (
      match List.rev items with
      | [] | [ _ ] ->
          Error
            [
              diagnostic ~span "lower/type-expression"
                "Function type requires at least one parameter and a return \
                 type.";
            ]
      | ret_expr :: rev_params -> (
          match parse_type_expr ret_expr with
          | Error _ as error -> error
          | Ok ret -> (
              match parse_type_exprs (List.rev rev_params) with
              | Error _ as error -> error
              | Ok params -> Ok (Core_ast.TEFun (span, params, ret)))))
  | Ast.List (span, callee :: args) -> (
      match parse_type_expr callee with
      | Error _ as error -> error
      | Ok callee -> (
          match parse_type_exprs args with
          | Error _ as error -> error
          | Ok args -> Ok (Core_ast.TEApp (span, callee, args))))
  | Ast.Map (span, entries) -> parse_row_type span entries
  | _ ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "lower/type-expression"
            "Unsupported type expression.";
        ]

and parse_effect_type_set set_name expr =
  match expr with
  | Ast.Vector (span, items) -> (
      match parse_effect_type_set_items set_name items with
      | Error _ as error -> error
      | Ok args ->
          Ok
            (Core_ast.TEApp
               ( span,
                 Core_ast.TESym (span, set_name),
                 args )))
  | _ ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "lower/type-expression"
            (Printf.sprintf "%s entries must be written as a vector." set_name);
        ]

and parse_effect_type_set_items set_name items =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | Ast.Symbol (span, name) :: rest ->
        loop (Core_ast.TESym (span, name) :: acc) rest
    | item :: _ ->
        let message =
          if String.equal set_name "ErrorSet" then
            "Effect error entries must be type symbols."
          else "Effect requirement entries must be service or capability symbols."
        in
        Error
          [
            diagnostic ~span:(Ast.expr_span item) "lower/type-expression" message;
          ]
  in
  loop [] items

and parse_type_exprs exprs =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | expr :: rest -> (
        match parse_type_expr expr with
        | Error _ as error -> error
        | Ok typ -> loop (typ :: acc) rest)
  in
  loop [] exprs

and parse_row_type span entries =
  let rec loop acc = function
    | [] -> Ok (Core_ast.TERow (span, List.rev acc, None))
    | ((Ast.Symbol (_,"&") | Ast.Keyword (_,":*")),Ast.Symbol (_,tail)) :: rest ->
        if rest <> [] then Error [diagnostic ~span "lower/type-expression" "Row tail must be final."]
        else Ok (Core_ast.TERow (span,List.rev acc,Some tail))
    | (key, value) :: rest -> (
        match label_name key with
        | None ->
            Error
              [
                diagnostic ~span:(Ast.expr_span key) "lower/type-expression"
                  "Row type field names must be symbols, keywords, or strings.";
              ]
        | Some label -> (
            match parse_type_expr value with
            | Error _ as error -> error
            | Ok typ -> loop ((label, typ) :: acc) rest))
  in
  loop [] entries

let attach_signature signature_expr def_expr =
  match def_expr with
  | Core_ast.Def (node, name, None, value) ->
      Ok (Core_ast.Def (node, name, Some signature_expr, value))
  | Core_ast.Def _ ->
      Error
        [
          diagnostic
            ~span:(Core_ast.expr_span def_expr)
            "lower/signature" "Definition already has a type signature.";
        ]
  | _ ->
      Error
        [
          diagnostic
            ~span:(Core_ast.expr_span def_expr)
            "lower/signature"
            "Type signatures must be followed by a definition.";
        ]

let type_signature = function
  | Ast.List
      ( _,
        [
          (Ast.Symbol (_, ":") | Ast.Keyword (_, ":"));
          Ast.Symbol (_, name);
          type_expr;
        ] ) ->
      Some (name, type_expr)
  | _ -> None

let definition_name = function
  | Ast.List
      ( _,
        Ast.Symbol (_, ("define" | "__operation")) :: Ast.Symbol (_, name)
        :: _ ) ->
      Some name
  | Ast.List
      ( _,
        Ast.Symbol (_, "define") :: Ast.List (_, Ast.Symbol (_, name) :: _) :: _
      ) ->
      Some name
  | _ -> None
