let diagnostic = Type_diagnostic.make
let plain_scheme ty = Type_env.Forall ([],ty,[],Type_env.Plain)
let lower_diagnostics diagnostics = List.map (fun (d:Lower_common.diagnostic) -> diagnostic ?span:d.span d.code d.message) diagnostics
let infer_structural_alias env = function
  | Ast.List (span, [Ast.Symbol (_, "__type-alias"); Ast.List (_, Ast.Symbol (_, name) :: params); body]) ->
        let names = List.filter_map (function Ast.Symbol (_, n) when Surface.is_lower n -> Some n | _ -> None) params in
        if List.length names <> List.length params || List.length (List.sort_uniq String.compare names) <> List.length names then
          Error [diagnostic ~span "typecheck/type-parameters" "Type parameters must be distinct lowercase symbols."]
        else
          let variables = List.map (fun n -> n, Type_expr.fresh_tyvar ()) names in
          let local = List.fold_left (fun env (n,t) -> Type_env.bind n (plain_scheme t) env) env variables in
          (match Lower_type.parse_type_expr body with
          | Error ds -> Error (lower_diagnostics ds)
          | Ok body -> match Type_resolve.resolve local body with
            | Error _ as e -> e
            | Ok result ->
                let ids = List.filter_map (function _, Type_expr.TVar id -> Some id | _ -> None) variables in
                let alias = Type_env.Forall (ids, Type_expr.TFn (List.map snd variables, result), [], Type_env.Plain) in
                Ok (Type_expr.TDeclaration, Type_env.bind ("__alias/" ^ name) alias env))
  | _ -> assert false
