type value = Value.t =
  | VNil
  | VBool of bool
  | VInt of int
  | VFloat of float
  | VString of string
  | VSymbol of string
  | VKeyword of string
  | VList of value list
  | VVector of value list
  | VMap of (value * value) list
  | VDictionary of (value * value) list
  | VClosure of closure
  | VMacro of closure

and closure = Value.closure = {
  params : string list;
  rest_param : string option;
  body : Ast.expr list;
  env : (string * value) list;
}

type diagnostic = Eval_common.diagnostic = {
  span : Ast.span option;
  code : string;
  message : string;
}

type context = {
  eval_expr : Env.t -> Reader.expr -> (value, diagnostic list) result;
}

let gensym_counter = ref 0
let diagnostic = Eval_common.diagnostic

let eval_gensym ctx env = function
  | [] ->
      incr gensym_counter;
      Ok (VSymbol (Printf.sprintf "g__%d" !gensym_counter))
  | [ prefix ] -> (
      match ctx.eval_expr env prefix with
      | Ok (VString prefix) ->
          incr gensym_counter;
          Ok (VSymbol (Printf.sprintf "%s__%d" prefix !gensym_counter))
      | Ok (VSymbol prefix) ->
          incr gensym_counter;
          Ok (VSymbol (Printf.sprintf "%s__%d" prefix !gensym_counter))
      | Ok _ ->
          incr gensym_counter;
          Ok (VSymbol (Printf.sprintf "g__%d" !gensym_counter))
      | Error _ as error -> error)
  | _ ->
      Error
        [
          diagnostic "eval/arity"
            "gensym expects zero arguments or one prefix argument.";
        ]

let eval_sexpr_sym_name ctx env = function
  | [ expr ] -> (
      match ctx.eval_expr env expr with
      | Ok (VSymbol name) | Ok (VKeyword name) | Ok (VString name) ->
          Ok (VString name)
      | Ok _ -> Ok VNil
      | Error _ as error -> error)
  | _ ->
      Error
        [ diagnostic "eval/arity" "sexpr-sym-name expects one syntax value." ]

let eval_sexpr_list ctx env = function
  | [ expr ] -> (
      match ctx.eval_expr env expr with
      | Ok (VList _ | VVector _) -> Ok (VBool true)
      | Ok _ -> Ok (VBool false)
      | Error _ as error -> error)
  | _ ->
      Error [ diagnostic "eval/arity" "sexpr-list? expects one syntax value." ]

let eval_sexpr_items ctx env = function
  | [ expr ] -> (
      match ctx.eval_expr env expr with
      | Ok (VList items | VVector items) -> Ok (VList items)
      | Ok _ -> Ok (VList [])
      | Error _ as error -> error)
  | _ ->
      Error [ diagnostic "eval/arity" "sexpr-items expects one syntax value." ]

let base_type value = match Quote.syntax_of_value value with
  | Ok syntax -> Quote.value_of_syntax (Type_syntax.strip syntax)
  | Error _ -> value

let declaration_fields env owner =
  let lookup n = match Eval_meta.current_lookup_declaration () with
    | Some lookup -> Eval_meta_util.overlay_lookup_option lookup (fun n -> Env.lookup n env) n
    | None -> Env.lookup n env in
  match lookup (Value.to_str_part owner) with
  | Some declaration -> (match Eval_slot.declaration_form declaration with
      | Some form -> (match lookup ("__form.types/" ^ form) with
          | Some (VMap fields) -> List.concat_map (fun (key,t) -> match t with
              | VList [VSymbol "Record";VSymbol "Type"] -> (match Eval_slot.slot_value_with_lookup ~lookup declaration key with
                  | VMap fields -> List.map (fun (k,t) -> let n=Value.to_str_part k in (VString (if String.starts_with ~prefix:":" n then String.sub n 1 (String.length n-1) else n),t)) fields
                  | _ -> [])
              | _ -> []) fields
          | _ -> [])
      | None -> [])
  | None -> []

let eval ctx env op args =
  let some result = Result.map (fun value -> Some value) result in
  match op with
  | ("Some" | "Option.Some" | "Ok" | "Result.Ok" | "Err" | "Result.Err") -> (match args with [arg] -> ctx.eval_expr env arg |> Result.map (fun value -> let n=List.hd (List.rev (String.split_on_char '.' op)) in Some (VMap [VKeyword ":_tag",VString n;VKeyword ":value",value])) | _ -> Error [diagnostic "eval/arity" (op ^ " expects one payload")])
  | "form/project" -> (match args with
      | [expression] ->
          let disabled=Sys.getenv_opt "FORMA_DISABLE_NATIVE_ELABORATION"=Some "1" in
          let plan=if disabled || not (Form_projection.can_run env expression) then None else Form_projection.cached expression in
          let value=match plan with
            | None -> ctx.eval_expr env expression
            | Some plan -> plan (fun env name values ->
                let span=Ast.expr_span expression in
                let rec quoted = function
                  | [] -> Ok []
                  | value :: rest -> (match Quote.syntax_of_value value,quoted rest with
                      | Ok value,Ok rest -> Ok (Ast.List (span,[Ast.Symbol (span,"quote");value]) :: rest)
                      | Error _,_ -> Error [diagnostic "eval/projection" "Invalid projection primitive argument"]
                      | _,Error diagnostics -> Error diagnostics) in
                match name,values with
                | "__symbol",[Value.VSymbol name] -> ctx.eval_expr env (Ast.Symbol (span,name))
                | _ -> (match quoted values with
                    | Error _ as error -> error
                    | Ok args -> ctx.eval_expr env (Ast.List (span,Ast.Symbol (span,name) :: args)))) env in
          value |> Result.map Option.some
      | _ -> Error [diagnostic "eval/arity" "form/project expects one projection expression"])
  | "meta/entries" -> (match args with
      | [arg] -> (match ctx.eval_expr env arg with
          | Ok (VMap fields) -> Ok (Some (VList (List.map (fun (key,value) -> VVector [key;value]) fields)))
          | Ok _ -> Error [diagnostic "eval/type" "meta/entries expects a record"]
          | Error _ as error -> error)
      | _ -> Error [diagnostic "eval/arity" "meta/entries expects one record"])
  | "attribute-type" -> (match args with
      | [attribute] -> (match ctx.eval_expr env attribute with
        | Error _ as error -> error
        | Ok attribute ->
          let wanted=Value.to_str_part attribute |> fun n -> if String.starts_with ~prefix:":" n then String.sub n 1 (String.length n-1) else n in
          let context_env=Option.value ~default:env (Eval_meta.current_environment ()) in
          let result=Env.visible_bindings context_env |> List.find_map (fun (owner,declaration) ->
            let lookup=Eval_meta_util.runtime_lookup Eval_meta.current_lookup_declaration env in
            let slot key =
              let identifier=Option.bind (Descriptor.declaration_form declaration) (Descriptor.form_with_lookup ~lookup)
                |> Option.fold ~none:false ~some:(fun (form:Descriptor.form) -> List.exists (fun (i:Descriptor.identifier_spec)->i.name=key) form.identifiers) in
              if identifier then Eval_slot.identifier_value_with_lookup ~lookup declaration (VString key)
              else Eval_slot.slot_value_with_lookup ~lookup declaration (VString key) in
            let direct=if owner=wanted && slot "value-type"<>VNil then Some (base_type (slot "value-type")) else List.find_map (fun endpoint -> match slot endpoint with VSymbol entity when Surface.namespace_of owner ^ "/" ^ Surface.namespace_of entity=wanted -> Some (VList [VSymbol "Id";VSymbol entity]) | _ -> None) ["source";"target"] in
            match direct with Some _ as result -> result | None -> declaration_fields env (VSymbol owner) |> List.find_map (fun (key,t) ->
              let key=Value.to_str_part key in
              let id=if String.contains key '/' then key else Surface.namespace_of owner ^ "/" ^ key in
              let id=if String.starts_with ~prefix:":" id then String.sub id 1 (String.length id-1) else id in
              if id=wanted then Some (base_type t) else None)) in
          (match result with Some t -> Ok (Some t) | None -> Error [diagnostic "elaborate/unknown-attribute" ("Unknown attribute " ^ wanted)]))
      | _ -> Error [diagnostic "eval/arity" "attribute-type expects an attribute keyword"])
  | "declaration-hole" -> (match args with
      | [owner;key] -> (match ctx.eval_expr env owner,ctx.eval_expr env key with
          | Ok owner,Ok key ->
              let lookup=Eval_meta_util.runtime_lookup Eval_meta.current_lookup_declaration env in
              (match lookup (Value.to_str_part owner) with
              | None -> Ok (Some VNil)
              | Some declaration -> let key_name=Value.to_str_part key in let key_name=if String.starts_with ~prefix:":" key_name then String.sub key_name 1 (String.length key_name-1) else key_name in
                  let identifier=Option.bind (Descriptor.declaration_form declaration) (Descriptor.form_with_lookup ~lookup) |> Option.fold ~none:false ~some:(fun (form:Descriptor.form) -> List.exists (fun (i:Descriptor.identifier_spec)->i.name=key_name) form.identifiers) in
                  let value=if identifier then Eval_slot.identifier_value_with_lookup ~lookup declaration (VString key_name) else if Option.fold ~none:false ~some:(fun (slot:Descriptor.typed_slot) -> slot.many) (Eval_slot.slot_spec_with_lookup ~lookup declaration key_name) then VList (Eval_slot.slot_values_with_lookup ~lookup declaration (VString key_name)) else Eval_slot.slot_value_with_lookup ~lookup declaration (VString key_name) in Ok (Some value))
          | Error ds,_ | _,Error ds -> Error ds)
      | _ -> Error [diagnostic "eval/arity" "declaration-hole expects a declaration and a hole name"])
  | "declaration-fields" -> (match args with [owner] -> ctx.eval_expr env owner |> Result.map (fun owner -> Some (VMap (declaration_fields env owner))) | _ -> Error [diagnostic "eval/arity" "declaration-fields expects a declaration"])
  | "row-of" -> (match args with [owner;selected] -> (match ctx.eval_expr env owner,ctx.eval_expr env selected with
      | Ok owner,Ok selected -> let fields=declaration_fields env owner in let keys=match selected with VList keys | VVector keys when keys<>[] -> List.map Value.to_str_part keys | _ -> List.map (fun (k,_) -> Value.to_str_part k) fields in
          let unknown=List.filter (fun k -> not (List.exists (fun (key,_) -> Value.to_str_part key=k) fields)) keys in
          if unknown<>[] then Error [diagnostic "elaborate/unknown-field" ("Unknown field " ^ String.concat ", " unknown)] else Ok (Some (VMap (List.map (fun k -> VKeyword (":" ^ k),base_type (List.assoc (VString k) fields)) keys)))
      | Error e,_ | _,Error e -> Error e) | _ -> Error [diagnostic "eval/arity" "row-of expects declaration and selected fields"])
  | "schema/validate-record" -> (match args with
      | [schema; value] -> (match ctx.eval_expr env schema, ctx.eval_expr env value with
          | Ok schema, Ok value -> (match Quote.syntax_of_value schema with
              | Error _ -> Error [diagnostic "eval/schema-type" "Expected record type syntax."]
              | Ok schema -> let errors=Surface_contract.errors env ~path:"fields" value (Type_syntax.strip schema) in
                  Ok (Some (VList (List.map (fun message -> VMap [VKeyword ":severity",VKeyword ":error";VKeyword ":slot",VKeyword ":fields";VKeyword ":message",VString message]) errors))))
          | Error ds,_ | _,Error ds -> Error ds)
      | _ -> Error [diagnostic "eval/arity" "schema/validate-record expects a type and record."])
  | "keyword/name" -> (match args with [arg] -> ctx.eval_expr env arg |> Result.map (fun value -> let n=Value.to_str_part value in Some (Value.VString (if String.starts_with ~prefix:":" n then String.sub n 1 (String.length n-1) else n))) | _ -> Error [diagnostic "eval/arity" "keyword/name expects one name"])
  | "keyword" ->
      let rec values = function [] -> Ok [] | a :: rest -> (match ctx.eval_expr env a,values rest with Ok a,Ok rest -> Ok (a :: rest) | Error e,_ | _,Error e -> Error e) in
      (match values args with
      | Ok [n] -> Ok (Some (Value.VKeyword (let n=String.trim (Value.to_str_part n) in if String.starts_with ~prefix:":" n then n else ":" ^ n)))
      | Ok [owner;key] -> let key=Value.to_str_part key in let key=if String.starts_with ~prefix:":" key then String.sub key 1 (String.length key-1) else key in Ok (Some (Value.VKeyword (":" ^ (if String.contains key '/' then key else Surface.namespace_of (Value.to_str_part owner) ^ "/" ^ key))))
      | Error e -> Error e | _ -> Error [diagnostic "eval/arity" "keyword expects one or two names"])
  | "type/metadata" -> (match args with
      | [arg] -> (match ctx.eval_expr env arg with
          | Error _ as e -> e
          | Ok value -> let metadata=match Quote.syntax_of_value value with Ok syntax -> snd (Type_syntax.split syntax) | _ -> [] in
              let rec fields = function key :: value :: rest -> (Quote.value_of_syntax key,Quote.value_of_syntax value) :: fields rest | _ -> [] in
              Ok (Some (VMap (fields metadata))))
      | _ -> Error [diagnostic "eval/arity" "type/metadata expects one type"])
  | "type/kind" -> (match args with
      | [arg] -> ctx.eval_expr env arg |> Result.map (fun value ->
          let context_env=Option.value ~default:env (Eval_meta.current_environment ()) in
          let n=Value.to_str_part value in
          Some (match Env.lookup ("__type-kind/" ^ n) context_env with Some kind -> kind | None -> if Env.lookup ("__type/" ^ n) context_env<>None then VKeyword ":type" else VNil))
      | _ -> Error [diagnostic "eval/arity" "type/kind expects a type name"])
  | "type/base" -> (match args with
      | [arg] -> ctx.eval_expr env arg |> Result.map (fun value -> Some (match Quote.syntax_of_value value with Ok syntax -> Quote.value_of_syntax (fst (Type_syntax.split syntax)) | Error _ -> value))
      | _ -> Error [diagnostic "eval/arity" "type/base expects one type"])
  | "meta" -> (match args with [t;key;default] -> (match ctx.eval_expr env t,ctx.eval_expr env key with
      | Ok t,Ok key -> let items=match t with Value.VList (Value.VSymbol "Option" :: [Value.VList values]) -> values | Value.VList values | Value.VVector values -> values | _ -> [] in
        let rec lookup = function k :: value :: _ when Value.equal k key -> Some value | _ :: rest -> lookup rest | [] -> None in (match lookup items with Some value -> Ok (Some value) | None -> ctx.eval_expr env default |> Result.map Option.some)
      | Error e,_ | _,Error e -> Error e) | _ -> Error [diagnostic "eval/arity" "meta expects a type, key and default"])
  | "sym" -> (match args with [arg] -> ctx.eval_expr env arg |> Result.map (fun value -> Some (Value.VSymbol (Value.to_str_part value))) | _ -> Error [diagnostic "eval/arity" "sym expects one name"])
  | "form/ensure" -> (match args with [value;t] ->
      (match ctx.eval_expr env value,ctx.eval_expr env t with
       | Ok value,Ok t -> (match Quote.syntax_of_value t with
          | Ok schema -> let errors = Surface_contract.errors env value schema in if errors = [] then Ok (Some (Surface_contract.normalize env value schema)) else Error [diagnostic "elaborate/hole-type" (String.concat "; " errors)]
          | Error _ -> Error [diagnostic "elaborate/type" "Invalid form type"])
       | Error diagnostics,_ | _,Error diagnostics -> Error diagnostics)
      | _ -> Error [diagnostic "eval/arity" "form/ensure expects a value and a type"])
  | "List" | "Option" | "Map" -> ctx.eval_expr env (Ast.Vector ((match args with t :: _ -> Ast.expr_span t | [] -> Ast.expr_span (Ast.Symbol ({Ast.source_id="form";start_offset=0;end_offset=0},op))),args)) |> Result.map (fun values -> Some (Value.VList (Value.VSymbol op :: (match values with Value.VList values | Value.VVector values -> values | _ -> []))))
  | "gensym" -> some (eval_gensym ctx env args)
  | "sexpr-sym-name" -> some (eval_sexpr_sym_name ctx env args)
  | "sexpr-list?" -> some (eval_sexpr_list ctx env args)
  | "sexpr-items" -> some (eval_sexpr_items ctx env args)
  | _ -> Ok None
