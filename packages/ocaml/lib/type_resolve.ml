open Type_expr

let diagnostic = Type_diagnostic.make

let uppercase_initial name =
  String.length name > 0
  &&
  let first = name.[0] in
  Char.uppercase_ascii first = first && Char.lowercase_ascii first <> first

let make_type_application callee args =
  match (callee, args) with
  | TNamed "List", [ item ] -> Ok (TList item)
  | TNamed "Vector", [ item ] -> Ok (TVector item)
  | TNamed "Map", [key;value] ->
      let rec valid_key = function TVar _ | TString -> true | TNamed n -> String.starts_with ~prefix:":" n || String.starts_with ~prefix:"\"" n | TNamedApp ("Brand",[_;TString]) -> true | TNamedApp ("Union",xs) -> xs<>[] && List.for_all (function TNamed n -> String.starts_with ~prefix:":" n || String.starts_with ~prefix:"\"" n | _ -> false) xs | _ -> false in
      if valid_key key then Ok (TNamedApp ("Map",[key;value])) else Error [diagnostic "typecheck/map-key" "Map keys must be String, a String brand, or a union of keyword or string literals."]
  | TNamed "Map", _ -> Error [diagnostic "typecheck/kind-mismatch" "Map expects two type arguments."]
  | TNamed name, args -> Ok (TNamedApp (name, args))
  | _ -> Ok (TApp (callee, args))

let rec resolve env = function
  | Core_ast.TESym (_, name) -> (
      match name with
      | "Int" -> Ok TInt
      | "Num" | "Number" -> Ok TFloat
      | "Float" -> Ok TFloat
      | "Bool" | "Boolean" -> Ok TBool
      | "Str" | "String" -> Ok TString
      | "Nil" | "Unit" -> Ok TNil
      | "Keyword" -> Ok TKeyword
      | "Symbol" -> Ok TSymbol
      | "Syntax" -> Ok TSyntax
      | "Any" | "_" -> Ok TAny
      | name -> (
          match (match Type_env.lookup ("__type/" ^ name) env with Some t -> Some t | None -> Type_env.lookup name env) with
          | Some ty -> Ok ty
          | None when Option.is_some (Type_unify.literal_base name) -> Ok (TNamed name)
          | None when uppercase_initial name -> Ok (TNamed name)
          | None ->
              Error
                [
                  diagnostic "typecheck/unknown-type"
                    (Printf.sprintf "Unknown type %S." name);
                ]))
  | Core_ast.TEFun (_, params, result) -> (
      match (resolve_many env params, resolve env result) with
      | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics
      | Ok params, Ok result -> Ok (TFn (params, result)))
  | Core_ast.TEApp
      (span, Core_ast.TESym (_, (("List" | "Vector") as name)), args)
    when List.length args <> 1 ->
      Error
        [
          diagnostic ~span "typecheck/kind-mismatch"
            (Printf.sprintf "%s expects exactly one type argument." name);
        ]
  | Core_ast.TEApp
      (_, Core_ast.TESym (_, (("ErrorSet" | "RequirementSet") as name)), args)
    ->
      let item = function
        | Core_ast.TESym (_, item_name) -> Ok (TNamed item_name)
        | other -> resolve env other
      in
      let rec loop acc = function
        | [] -> Ok (TNamedApp (name, List.rev acc))
        | arg :: rest -> (
            match item arg with
            | Error _ as error -> error
            | Ok typ -> loop (typ :: acc) rest)
      in
      loop [] args
  | Core_ast.TEApp (span, Core_ast.TESym (_, name), args) when Option.is_some (Type_env.lookup ("__alias/" ^ name) env) ->
      (match Type_env.lookup ("__alias/" ^ name) env, resolve_many env args with
      | Some (TFn (params, result)), Ok args when List.length params = List.length args ->
          Type_unify.unify_many params args |> Result.map (fun subst -> apply_subst subst result)
      | _, Error ds -> Error ds
      | _ -> Error [diagnostic ~span "typecheck/kind-mismatch" (name ^ " has an incorrect number of type arguments.")])
  | Core_ast.TEApp (_, callee, args) -> (
      match (resolve env callee, resolve_many env args) with
      | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics
      | Ok callee, Ok args -> make_type_application callee args)
  | Core_ast.TERow (_, fields, None) -> resolve_record_type_fields env fields
  | Core_ast.TERow (span, fields, Some row) ->
      (match resolve_record_type_fields env fields,resolve env (Core_ast.TESym (span,row)) with
       | Ok (TRecord fields),Ok tail -> Ok (TOpenRecord (fields,tail))
       | Error ds,_ | _,Error ds -> Error ds | _ -> assert false)

and resolve_many env exprs =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | expr :: rest -> (
        match resolve env expr with
        | Error _ as error -> error
        | Ok typ -> loop (typ :: acc) rest)
  in
  loop [] exprs

and resolve_record_type_fields env fields =
  let rec loop acc = function
    | [] -> Ok (TRecord (sort_record_fields (List.rev acc)))
    | (label, expr) :: rest -> (
        match resolve env expr with
        | Error _ as error -> error
        | Ok typ -> loop ((label, typ) :: acc) rest)
  in
  loop [] fields

let resolve_polymorphic env expression =
  let env = Typed_toplevel_typevars.collect_implicit [] expression |> List.sort_uniq String.compare
    |> List.fold_left (fun env n -> Type_env.bind n (Type_env.Forall ([],Type_expr.fresh_tyvar (),[],Type_env.Plain)) env) env in
  resolve env expression |> Result.map (fun t -> env,t)
