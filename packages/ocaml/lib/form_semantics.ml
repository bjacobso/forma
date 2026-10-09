(* Semantic checks follow a form's declared hole types and scope functions. *)
let diagnostic ?span code message = Eval_common.diagnostic ?span code message
let name value = Value.to_str_part value
let optional = function Value.VList [Value.VSymbol "Option";t] -> true,t | t -> false,t
let fields env key form = match Env.lookup (key ^ form) env with Some (Value.VMap fields) -> fields | _ -> []
let hole_value env declaration form hole =
  match Descriptor.form env form with
  | Some descriptor when List.exists (fun (i:Descriptor.identifier_spec) -> i.name=(let n=name hole in if String.starts_with ~prefix:":" n then String.sub n 1 (String.length n-1) else n)) descriptor.identifiers ->
      let lookup n=Env.lookup n env in
      Eval_slot.identifier_value_with_lookup ~lookup declaration hole
  | _ when (match Env.lookup ("__form/" ^ form) env with Some (Value.VList pattern) -> (match List.rev pattern with Value.VSymbol "..." :: Value.VSymbol n :: _ -> name hole=":" ^ n || name hole=n | _ -> false) | _ -> false) ->
      Value.VList (Eval_slot.slot_values_with_lookup ~lookup:(fun n -> Env.lookup n env) declaration hole)
  | _ -> Eval_slot.slot_value_with_lookup ~lookup:(fun n -> Env.lookup n env) declaration hole
let holes env declaration form =
  fields env "__form.types/" form |> List.map (fun (hole,t) ->
    let _,t=optional t in
    let value=hole_value env declaration form hole in
    let value=match t,value with Value.VList [Value.VSymbol "Record";_],Value.VMap entries -> Value.VList (List.map (fun (k,v)->Value.VVector [k;v]) entries) | _ -> value in
    hole,value)
let invoke env fn arguments =
  match Quote.syntax_of_value fn with
  | Error _ -> Error [diagnostic "elaborate/form-hook" "Invalid form hook"]
  | Ok fn ->
      let s=Ast.expr_span fn in
      let env=List.mapi (fun i value -> "__form.argument" ^ string_of_int i,value) arguments |> List.fold_left (fun env (n,v)->Env.bind n v env) env in
      let args=List.mapi (fun i _ -> Ast.Symbol (s,"__form.argument" ^ string_of_int i)) arguments in
      Eval.evaluate_program_with_env env [Ast.List (s,fn :: args)] |> Result.map fst
let resolve_type value =
  match Quote.syntax_of_value value with
  | Error _ -> Error [diagnostic "elaborate/hole-type" "Invalid type syntax"]
  | Ok t -> (match Lower_type.parse_type_expr t with
      | Error ds -> Error (List.map (fun (d:Lower_common.diagnostic) -> diagnostic ?span:d.span d.code (d.message ^ " Type: " ^ Ast.expr_to_json t)) ds)
      | Ok t -> Type_resolve.resolve [] t |> Result.map_error (List.map (fun (d:Type_diagnostic.t)->diagnostic ?span:d.span d.code d.message)))
let rec validate ?syntax ?(scope=[]) ~span env declaration =
  let authored hole = let hole=name hole in let hole=if String.starts_with ~prefix:":" hole then hole else ":" ^ hole in match syntax with
    | Some (Ast.List (_,Ast.Symbol (_,form) :: args)) ->
        let args=Surface_form.normalize_application env form args in
        List.find_map (function Ast.List (_,(Ast.Symbol (_,n) | Ast.Keyword (_,n)) :: [value]) when n=hole -> Some value | _ -> None) args
    | _ -> None in
  let notices = ref [] in
  let success () = Ok (List.rev !notices) in
  match Descriptor.declaration_form declaration with
  | None -> success ()
  | Some form when Env.lookup ("__form/" ^ form) env=None -> success ()
  | Some form ->
      let types=fields env "__form.types/" form in
      let options=fields env "__form.options/" form in
      let hole_values=Value.VMap (holes env declaration form) in
      let scopes=match List.assoc_opt (Value.VKeyword ":scope") options with Some (Value.VMap scopes) -> scopes | _ -> [] in
      let reference_span value =
        let rec find = function
          | Ast.Symbol (s,n) when n=name value -> Some s
          | Ast.List (_,xs) | Ast.Vector (_,xs) -> List.find_map find xs
          | Ast.Map (_,pairs) -> List.find_map (fun (k,v)->match find k with Some _ as span->span | None->find v) pairs
          | _ -> None in
        Option.value ~default:span (Option.bind syntax find) in
      let check_reference expected value =
        match Env.lookup (name value) env with
        | None -> Error [diagnostic ~span:(reference_span value) "elaborate/unknown-reference" ("Unknown reference " ^ name value)]
        | Some referred ->
            let classification = match (match referred with Value.VMap fields->Value.lookup_map fields (Value.VKeyword ":classification") | _->None) with Some _ as t -> t | None -> Option.bind (Descriptor.declaration_form referred) (fun declared_form ->
              match fields env "__form.types/" declared_form |> List.find_map (function _,Value.VList [Value.VSymbol "Declares";t] -> Some t | _ -> None) with
              | Some t -> Some t
              | None -> Option.bind (Descriptor.form env declared_form) (fun descriptor -> descriptor.result_type)) in
            if classification = Some expected then Ok ()
            else Error [diagnostic ~span:(reference_span value) "elaborate/reference-type" (name value ^ " does not declare " ^ name expected)] in
      let rec check = function
        | [] ->
          let result_type = match List.assoc_opt (Value.VKeyword ":type") options with
            | Some (Value.VList (Value.VSymbol "fn" :: _) as fn) -> (match invoke env fn [hole_values] with Error _ as e -> e | Ok value -> resolve_type value |> Result.map (fun _ -> ()))
            | _ -> Ok () in
          (match result_type with Error _ as e -> e | Ok () -> match List.assoc_opt (Value.VKeyword ":check") options with
            | None -> success ()
            | Some _ -> (match Eval.apply_named env ("form/" ^ form ^ "/validate") declaration with
                | Error _ as error -> error
                | Ok (Value.VList diagnostics | Value.VVector diagnostics) ->
                    let invalid = ref false in
                    let diagnostics=List.filter_map (function Value.VMap fields ->
                      let severity=Option.value ~default:(Value.VString "error") (List.assoc_opt (Value.VKeyword ":severity") fields) |> name in
                      let severity=match severity with "error" | ":error" -> Diagnostic.Error | "warning" | ":warning" -> Diagnostic.Warning | "info" | ":info" -> Diagnostic.Info | _ -> invalid:=true; Diagnostic.Error in
                      let message=Option.value ~default:(Value.VString "Form validation failed") (List.assoc_opt (Value.VKeyword ":message") fields) |> name in
                      let code=Option.value ~default:(Value.VString "elaborate/form-check") (List.assoc_opt (Value.VKeyword ":code") fields) |> name in
                      let path=Option.map name (List.assoc_opt (Value.VKeyword ":slot") fields) in
                      let span=Option.bind path (fun key->Option.map Ast.expr_span (authored (Value.VString key))) |> Option.value ~default:span in
                      Some {Diagnostic.span;severity;code;message;path;notes=[];fixes=[]}
                      | _ -> invalid:=true;None) diagnostics in
                    if !invalid then Error [diagnostic ~span "elaborate/form-check" "Invalid form diagnostic"] else
                    let errors=List.filter (fun d -> d.Diagnostic.severity=Diagnostic.Error) diagnostics in
                    if errors=[] then Ok (List.rev !notices @ diagnostics)
                    else Error (List.map (fun d -> diagnostic ~span:d.Diagnostic.span d.code d.message) errors)
                | Ok _ -> Error [diagnostic "elaborate/form-check" ":check must return a list of diagnostics"]))
        | (hole,t) :: rest ->
            let is_optional,t=optional t in
            let value=hole_value env declaration form hole in
            if is_optional && value=Value.VNil then check rest else
            match t with
            | Value.VSymbol "Type"
            | Value.VList [Value.VSymbol "Record";Value.VSymbol "Type"] ->
                let syntax = match t,value with Value.VList [Value.VSymbol "Record";_],Value.VMap fields -> List.map snd fields | _ -> [value] in
                let problems=List.concat_map (fun value -> match Quote.syntax_of_value value with Ok syntax -> Type_syntax.errors syntax | Error _ -> ["Expected type syntax"]) syntax in
                if problems=[] then check rest else Error (List.map (diagnostic "elaborate/type-syntax") problems)
            | (Value.VList [Value.VSymbol "List";Value.VSymbol child] | Value.VSymbol child) when Surface.is_lower child && Surface_form.child_family env child ->
                let scoped=match List.assoc_opt hole scopes with None -> Ok (Value.VMap scope) | Some fn -> invoke env fn [hole_values] in
                let value = match t with Value.VSymbol _ -> Value.VList [value] | _ -> value in
                (match scoped,value with
                | Error _ as e,_ -> e
                | Ok (Value.VMap bindings),(Value.VList children | Value.VVector children) ->
                    let authored_children=match syntax with Some (Ast.List (_,Ast.Symbol (_,parent) :: args)) -> Surface_form.normalize_application env parent args |> List.filter_map (function Ast.List (_,(Ast.Symbol (_,n) | Ast.Keyword (_,n)) :: [value]) when n=":" ^ name hole || n=name hole -> Some value | _ -> None) | _ -> [] in
                    let rec children_ index = function [] -> check rest | value :: remaining ->
                      (match Quote.syntax_of_value value with
                      | Error _ -> Error [diagnostic "elaborate/child-form" "Invalid child form syntax."]
                      | Ok generated -> let expr=Option.value ~default:generated (List.nth_opt authored_children index) in (match Surface_form.resolve_child env child expr with
                          | None -> Error [diagnostic "elaborate/child-form" ("Expected child form " ^ child)]
                          | Some expr -> match Eval.evaluate_program_with_env env [expr] with
                            | Error _ as e -> e
                            | Ok (declaration,_) -> match validate ~syntax:expr ~scope:(bindings @ scope) ~span:(Ast.expr_span expr) env declaration with Error _ as e -> e | Ok diagnostics -> notices := List.rev_append diagnostics !notices; children_ (index+1) remaining)) in children_ 0 children
                | _ -> Error [diagnostic "elaborate/child-form" "Child forms require a list and a record scope."])
            | Value.VList [Value.VSymbol "Refers";expected] -> (match check_reference expected value with Error _ as e -> e | Ok () -> check rest)
            | Value.VList [Value.VSymbol "List";Value.VList [Value.VSymbol "Refers";expected]] ->
                (match value with
                 | Value.VList values | Value.VVector values ->
                     let rec refs = function [] -> check rest | value :: values -> (match check_reference expected value with Error _ as e -> e | Ok () -> refs values) in refs values
                 | _ -> Error [diagnostic "elaborate/hole-type" "References require a list"])
            | Value.VList [Value.VSymbol "Expr";expected] ->
                let scoped=match List.assoc_opt hole scopes with None -> Ok (Value.VMap scope) | Some fn -> invoke env fn [hole_values] in
                (match scoped,Quote.syntax_of_value value,resolve_type (Option.value ~default:expected (List.assoc_opt (Value.VKeyword (":" ^ name expected)) (holes env declaration form))) with
                | Error e,_,_ | _,Error _,Error e | _,_,Error e -> Error e
                | _,Error _,_ -> Error [diagnostic "elaborate/expression" "Invalid expression syntax"]
                | Ok (Value.VMap bindings),Ok expr,Ok expected ->
                    let expr=Option.value ~default:expr (authored hole) in
                    let rec bind env = function [] -> Ok env | (key,t) :: rest -> (match resolve_type t with Error _ as e -> e | Ok t ->
                      let n=name key in let n=if String.starts_with ~prefix:":" n then String.sub n 1 (String.length n-1) else n in
                      bind (Type_env.bind n (Type_env.Forall ([],t,[],Type_env.Plain)) env) rest) in
                    (match bind [] (bindings @ scope) with Error _ as e -> e | Ok type_env ->
                      let externals=List.filter_map (fun (key,t) -> match Quote.syntax_of_value t with Ok t -> let n=name key in Some ((if String.starts_with ~prefix:":" n then String.sub n 1 (String.length n-1) else n),t) | Error _ -> None) (bindings @ scope) in
                      let prepared = Surface.body ~bound:(Surface.Names.of_list (List.map (fun (key,_) -> let n=name key in if String.starts_with ~prefix:":" n then String.sub n 1 (String.length n-1) else n) (bindings @ scope))) expr in
                      let eval_body env body = Eval.evaluate_program_with_env env body |> Result.map fst |> Result.map_error (List.map (fun (d:Eval_common.diagnostic) -> {Expand.span=d.span;code=d.code;message=d.message})) in
                      let expanded = Expand.expand_program ~eval_body env [prepared] |> Result.map fst |> Result.map_error (List.map (fun (d:Expand.diagnostic)->diagnostic ?span:d.span d.code d.message)) in
                      match (match expanded with Error _ as e -> e | Ok expressions -> Typecheck.typecheck_program_with_env_all type_env (Surface.coerce_program ~externals expressions) |> Result.map_error (List.map (fun (d:Type_diagnostic.t)->diagnostic ?span:d.span d.code d.message))) with
                      | Error ds -> Error ds
                      | Ok (types,_,_) -> let actual=match List.rev types with t :: _ -> t.Typecheck.typ | [] -> Type_expr.TNil in (match Type_unify.assign actual expected with Ok _ -> check rest | Error ds -> Error (List.map (fun (d:Type_diagnostic.t)->diagnostic ~span:(Option.value ~default:(Ast.expr_span expr) d.span) d.code d.message) ds)))
                | Ok _,_,_ -> Error [diagnostic "elaborate/scope" ":scope must return a record of bindings"])
            | Value.VList (Value.VSymbol "Declares" :: _) -> check rest
            | _ ->
                match Quote.syntax_of_value t with
                | Error _ -> Error [diagnostic "elaborate/hole-type" "Invalid hole type"]
                | Ok schema ->
                    let problems=Surface_contract.errors env ~path:(name hole) value schema in
                    if problems=[] then check rest else
                    let span=Option.fold ~none:span ~some:Ast.expr_span (authored hole) in
                    Error (List.map (diagnostic ~span "elaborate/hole-type") problems) in
      check types |> Result.map_error (List.map (fun (d:Eval_common.diagnostic) ->
        match d.span with
        | Some source_span when source_span.source_id=span.Ast.source_id -> d
        | _ -> {d with span=Some span}))
