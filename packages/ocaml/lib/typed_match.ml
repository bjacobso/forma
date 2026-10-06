type diagnostic = Type_diagnostic.t

open Type_expr
open Type_env
open Type_unify

type env = Type_env.env

type callbacks = {
  infer_expr : env -> Core_ast.expr -> (subst * ty, diagnostic list) result;
}

let diagnostic = Type_diagnostic.make

let rec infer_match callbacks env scrutinee arms =
  match callbacks.infer_expr env scrutinee with
  | Error _ as error -> error
  | Ok (scrutinee_subst, scrutinee_ty) -> (
      let env = apply_subst_env scrutinee_subst env in
      let scrutinee_ty = apply_subst scrutinee_subst scrutinee_ty in
      match infer_match_arms callbacks env scrutinee_ty arms with
      | Error _ as error -> error
      | Ok (arm_subst, ty) -> Ok (compose_subst arm_subst scrutinee_subst, ty))

and infer_match_arms callbacks env scrutinee_ty arms =
  match arms with
  | [] -> Ok ([], TNil)
  | [ arm ] -> infer_match_arm callbacks env scrutinee_ty arm
  | arm :: rest -> (
      match infer_match_arm callbacks env scrutinee_ty arm with
      | Error _ as error -> error
      | Ok (arm_subst, arm_ty) -> (
          let env = apply_subst_env arm_subst env in
          let scrutinee_ty = apply_subst arm_subst scrutinee_ty in
          match infer_match_arms callbacks env scrutinee_ty rest with
          | Error _ as error -> error
          | Ok (rest_subst, rest_ty) -> (
              let subst = compose_subst rest_subst arm_subst in
              let arm_ty = apply_subst subst arm_ty in
              let rest_ty = apply_subst subst rest_ty in
              let arm_effect = effect_parts arm_ty in
              let rest_effect = effect_parts rest_ty in
              match (arm_effect, rest_effect) with
              | None, None -> (
                  match join rest_ty arm_ty with
                  | Ok (unify_subst,joined) ->
                      let subst = compose_subst unify_subst subst in
                      Ok (subst, apply_subst subst joined)
                  | Error _ as error -> error)
              | _ -> (
                  let arm_success, arm_errors, arm_req =
                    match arm_effect with
                    | Some parts -> parts
                    | None -> (arm_ty, [], [])
                  in
                  let rest_success, rest_errors, rest_req =
                    match rest_effect with
                    | Some parts -> parts
                    | None -> (rest_ty, [], [])
                  in
                  match unify arm_success rest_success with
                  | Ok unify_subst ->
                      let subst = compose_subst unify_subst subst in
                      Ok
                        ( subst,
                          effect_type
                            (apply_subst subst arm_success)
                            (merge_type_sets arm_errors rest_errors)
                            (merge_type_sets arm_req rest_req) )
                  | Error _ as error -> error))))

and infer_match_arm callbacks env scrutinee_ty arm =
  match infer_pattern env scrutinee_ty arm.Core_ast.pattern with
  | Error _ as error -> error
  | Ok (pattern_subst, pattern_env) -> (
      let env = pattern_env @ apply_subst_env pattern_subst env in
      match callbacks.infer_expr env arm.body with
      | Error _ as error -> error
      | Ok (body_subst, body_ty) ->
          Ok (compose_subst body_subst pattern_subst, body_ty))

and infer_pattern env scrutinee_ty = function
  | Core_ast.PWild -> Ok ([], [])
  | Core_ast.PData syntax -> infer_data_pattern env scrutinee_ty syntax
  | Core_ast.PCon (name, vars) -> (
      match (match Type_env.lookup name env with Some _ as t -> t | None -> Typed_builtin.builtin_value_type name) with
      | Some (TFn (param_tys, result_ty)) -> (
          if List.length vars <> List.length param_tys then
            Error
              [
                diagnostic "typecheck/pattern-arity"
                  (Printf.sprintf
                     "Constructor %S expects %d pattern arguments, received %d."
                     name (List.length param_tys) (List.length vars));
              ]
          else
            match unify result_ty scrutinee_ty with
            | Error _ as error -> error
            | Ok subst ->
                let bindings =
                  List.map2
                    (fun var ty ->
                      (var, Forall ([], apply_subst subst ty, [], Plain)))
                    vars param_tys
                in
                Ok (subst, bindings))
      | Some ty -> (
          if vars <> [] then
            Error
              [
                diagnostic "typecheck/pattern-arity"
                  (Printf.sprintf
                     "Constructor %S expects 0 pattern arguments, received %d."
                     name (List.length vars));
              ]
          else
            match unify ty scrutinee_ty with
            | Error _ as error -> error
            | Ok subst -> Ok (subst, []))
      | None -> Error [diagnostic "typecheck/pattern-constructor" ("Unknown constructor: " ^ name)])

and infer_data_pattern env expected syntax =
  let bind n ty = (n, Forall ([],ty,[],Plain)) in
  let combine fields =
    let rec loop subst bindings = function
      | [] -> Ok (subst, bindings)
      | (syntax,ty) :: rest -> (match infer_data_pattern (bindings @ apply_subst_env subst env) (apply_subst subst ty) syntax with
        | Error _ as error -> error | Ok (next,bs) -> loop (compose_subst next subst) (bs @ bindings) rest)
    in loop [] [] fields in
  match syntax with
  | Ast.Symbol (_,"_") -> Ok ([],[])
  | Ast.Symbol (_,n) when Surface.is_lower n && n <> "nil" -> Ok ([],[bind n expected])
  | Ast.Map (_,pairs) when (match expected with TNamedApp ("Map",[_;_]) -> true | _ -> false) ->
      let key,item = match expected with TNamedApp ("Map",[key;item]) -> key,item | _ -> assert false in
      let rec loop subst children = function
        | [] -> Result.map (fun (s,bindings) -> compose_subst s subst,bindings) (combine children)
        | (Ast.Keyword (_,":as"),p)::rest -> loop subst ((p,expected)::children) rest
        | (k,p)::rest ->
            let actual = match k with Ast.Keyword (_,n) -> TNamed n | Ast.String (_,n) -> TNamed (Value.string_json n) | _ -> TAny in
            (match assign actual (apply_subst subst key) with Error _ as e -> e | Ok s -> loop (compose_subst s subst) ((p,item)::children) rest) in
      loop [] [] pairs
  | Ast.Map (_,pairs) ->
      let as_pattern=List.find_map (function Ast.Keyword (_,":as"),p -> Some p | _ -> None) pairs in
      let pairs=List.concat_map (function
        | Ast.Keyword (_,":as"),_ -> []
        | Ast.Keyword (_,":keys"), Ast.Vector (_,keys) -> List.map (fun k -> match k with Ast.Symbol (s,n) -> Ast.Keyword (s,":" ^ n),k | _ -> k,k) keys
        | p -> [p]) pairs in
      let label = function Ast.String (_,s) -> if String.starts_with ~prefix:":" s || String.starts_with ~prefix:"\000" s then "\000str:" ^ s else s | k -> Option.value ~default:"" (Surface.name k) in
      let fields=List.map (fun (k,v) -> label k,v,fresh_tyvar ()) pairs in
      let required=TOpenRecord (List.map (fun (n,_,ty) -> n,ty) fields,fresh_tyvar ()) in
      (match unify expected required with
       | Error _ as error -> error
       | Ok subst ->
           let children=List.map (fun (_,v,ty) -> v,apply_subst subst ty) fields in
           let children=match as_pattern with Some p -> (p,apply_subst subst expected)::children | None -> children in
           Result.map (fun (next,bs) -> compose_subst next subst,bs) (combine children))
  | Ast.Vector (_,items) ->
      let element = fresh_tyvar () in
      let list_ty = match expected with TVector _ -> TVector element | _ -> TList element in
      (match unify expected list_ty with
       | Error _ as error -> error
       | Ok subst ->
          let rec parts = function
            | [] -> Ok []
            | [Ast.Symbol (_,"&");rest] -> Ok [rest,apply_subst subst list_ty]
            | Ast.Symbol (_,"&") :: _ -> Error [diagnostic "typecheck/pattern-rest" "Rest pattern requires one final binder."]
            | p :: rest -> Result.map (fun ps -> (p,apply_subst subst element) :: ps) (parts rest) in
          match parts items with Error _ as error -> error | Ok ps -> Result.map (fun (next,bs) -> compose_subst next subst,bs) (combine ps))
  | Ast.List (_,Ast.Symbol (_,n) :: args) when Surface.is_upper n ->
      (match (match Type_env.lookup n env with Some _ as t -> t | None -> Typed_builtin.builtin_value_type n) with
       | Some (TFn (fields,result)) when List.length fields = List.length args ->
           (match unify expected result with Error _ as error -> error | Ok subst -> Result.map (fun (next,bs) -> compose_subst next subst,bs) (combine (List.map2 (fun p t -> p,apply_subst subst t) args fields)))
       | Some result when args = [] -> Result.map (fun subst -> subst,[]) (unify expected result)
       | _ -> Error [diagnostic "typecheck/pattern-constructor" ("Invalid constructor pattern " ^ n)])
  | Ast.Symbol (_,n) when Surface.is_upper n -> infer_pattern env expected (Core_ast.PCon (n,[]))
  | literal ->
      let ty = match literal with
        | Ast.Int (_,n) -> TNamed (string_of_int n)
        | Ast.Float (_,n) -> TNamed (string_of_float n)
        | Ast.Bool (_,b) -> TNamed (string_of_bool b)
        | Ast.String (_,s) -> TNamed (Value.string_json s)
        | Ast.Keyword (_,n) -> TNamed n
        | Ast.Nil _ -> TNil | _ -> TAny in
      let ty = match expected,ty with
        | TVar _,TNamed literal -> Option.value ~default:ty (Type_unify.literal_base literal)
        | _ -> ty in
      Result.map (fun subst -> subst,[]) (assign ty expected)

and pattern_bindings = function
  | Core_ast.PWild -> []
  | Core_ast.PData syntax ->
      let rec names = function
        | Ast.Symbol (_,n) when Surface.is_lower n && n<>"nil" && n<>"_" -> [n]
        | Ast.List (_,Ast.Symbol (_,n)::args) when Surface.is_upper n -> List.concat_map names args
        | Ast.Map (_,pairs) -> List.concat_map (fun (_,v) -> names v) pairs
        | Ast.Vector (_,items) -> List.concat_map names items
        | _ -> [] in
      List.sort_uniq String.compare (names syntax) |> List.map (fun n -> n,Forall ([],fresh_tyvar (),[],Plain))
  | Core_ast.PCon (_, vars) ->
      List.map (fun name -> (name, Forall ([], TAny, [], Plain))) vars

and effect_set_items set_name = function
  | TNamedApp (name, items) when name = set_name -> Some items
  | TApp (TNamed name, items) when name = set_name -> Some items
  | _ -> None

and effect_parts = function
  | TNamedApp ("Effect", [ success; errors; requirements ])
  | TApp (TNamed "Effect", [ success; errors; requirements ]) -> (
      match
        ( effect_set_items "ErrorSet" errors,
          effect_set_items "RequirementSet" requirements )
      with
      | Some errors, Some requirements -> Some (success, errors, requirements)
      | _ -> None)
  | _ -> None

and merge_type_sets left right =
  let rec loop seen acc = function
    | [] -> List.rev acc
    | ty :: rest ->
        let key = ty_to_string ty in
        if List.mem key seen then loop seen acc rest
        else loop (key :: seen) (ty :: acc) rest
  in
  loop [] [] (left @ right)

and effect_type success errors requirements =
  TNamedApp
    ( "Effect",
      [
        success;
        TNamedApp ("ErrorSet", errors);
        TNamedApp ("RequirementSet", requirements);
      ] )
