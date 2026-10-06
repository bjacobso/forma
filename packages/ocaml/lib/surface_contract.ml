(* One runtime contract derived from the same type declaration as the form. *)
let lookup entries key =
  let key = match key with Ast.Keyword (_,n) -> Value.VKeyword n | Ast.String (_,n) -> Value.VString n | _ -> Value.VNil in
  List.assoc_opt key entries
let rec errors env ?(path="payload") value schema =
  let schema=Surface_type_alias.resolve (Surface_type_alias.environment_lookup env) schema in
  let fail message = [path ^ " " ^ message] in
  let check value schema path = errors env ~path value schema in
  match schema,value with
  | Ast.List (_,Ast.Symbol (_,"Option") :: [_]),Value.VNil -> []
  | Ast.List (_,Ast.Symbol (_,"Option") :: [_]),Value.VMap entries when List.assoc_opt (Value.VKeyword ":_tag") entries=Some (Value.VString "None") -> []
  | Ast.List (_,Ast.Symbol (_,"Option") :: [t]),Value.VMap entries when List.assoc_opt (Value.VKeyword ":_tag") entries=Some (Value.VString "Some") -> (match List.assoc_opt (Value.VKeyword ":value") entries with Some value -> check value t path | None -> fail "Some is missing its value")
  | Ast.List (_,Ast.Symbol (_,"Option") :: [t]),value -> check value t path
  | Ast.Map (_,fields),Value.VMap entries ->
      let fields_errors = List.concat_map (fun (key,t) ->
        let label = Option.value ~default:"?" (Surface.name key) in
        let label = if String.starts_with ~prefix:":" label then String.sub label 1 (String.length label-1) else label in
        match lookup entries key with
        | None when Surface_type_alias.optional env t -> []
        | None -> [path ^ "." ^ label ^ " is required"]
        | Some value -> check value t (path ^ "." ^ label)) fields in
      fields_errors @ List.filter_map (fun (key,_) -> if List.exists (fun (label,_) -> Value.equal key (Quote.value_of_syntax label)) fields then None else Some (path ^ "." ^ Value.to_str_part key ^ " is not a declared field")) entries
  | Ast.Map _,_ -> fail "must be a record"
  | Ast.List (_,Ast.Symbol (_,"List") :: [t]),(Value.VList values | Value.VVector values) -> List.mapi (fun i v -> check v t (path ^ "[" ^ string_of_int i ^ "]")) values |> List.concat
  | Ast.List (_,Ast.Symbol (_,"List") :: [_]),_ -> fail "must be a list"
  | Ast.List (_,Ast.Symbol (_,"Id") :: [_]),Value.VString _ -> []
  | Ast.List (_,Ast.Symbol (_,"Id") :: [_]),_ -> fail "must be an entity ID string"
  | Ast.List (_,Ast.Symbol (_,"Brand") :: [t]),value -> check value t path
  | Ast.List (_,Ast.Symbol (_,"Union") :: arms),value -> if List.exists (fun t -> check value t path = []) arms then [] else fail "does not match any Union member"
  | Ast.List (_,Ast.Symbol (_,"Record") :: [t]),(Value.VList entries | Value.VVector entries) -> List.concat_map (function Value.VVector [Value.VKeyword _;v] | Value.VList [Value.VKeyword _;v] -> check v t path | _ -> fail "must contain keyword/value entries") entries
  | Ast.List (_,Ast.Symbol (_,"Record") :: [t]),Value.VMap entries -> List.concat_map (fun (k,v) -> check k (Surface.sym (Ast.expr_span t) "Keyword") (path ^ ".key") @ check v t path) entries
  | Ast.List (_,Ast.Symbol (_,"Map") :: [_key;t]),(Value.VMap entries | Value.VDictionary entries) -> List.concat_map (fun (k,v) -> check k _key (path ^ ".key") @ check v t path) entries
  | Ast.String (_,s),Value.VString v when s=v -> []
  | Ast.Int (_,s),Value.VInt v when s=v -> []
  | Ast.Float (_,s),Value.VFloat v when s=v -> []
  | Ast.Float (_,s),Value.VInt v when s=float_of_int v -> []
  | Ast.Bool (_,s),Value.VBool v when s=v -> []
  | Ast.Keyword (_,s),Value.VKeyword v when s=v -> []
  | (Ast.String _ | Ast.Int _ | Ast.Float _ | Ast.Bool _ | Ast.Keyword _),_ -> fail "does not match its literal type"
  | Ast.Symbol (_,"String"),Value.VString _
  | Ast.Symbol (_,"Symbol"),Value.VSymbol _
  | Ast.Symbol (_,"Keyword"),Value.VKeyword _
  | Ast.Symbol (_,"Int"),Value.VInt _
  | Ast.Symbol (_,"Number"),(Value.VInt _ | Value.VFloat _)
  | Ast.Symbol (_,"Bool"),Value.VBool _
  | Ast.Symbol (_,"Unit"),Value.VNil -> []
  | Ast.Symbol (_, ("String" | "Symbol" | "Keyword" | "Int" | "Number" | "Bool" | "Unit" as n)),_ -> fail ("must be " ^ n)
  | Ast.Symbol (_,("Any" | "Type" | "Syntax" | "RuntimeExpr" | "Json")),_ -> []
  | Ast.Symbol (_,n),value -> (match Env.lookup ("__type/" ^ n) env with
      | Some t -> (match Quote.syntax_of_value t with Ok t when t <> schema -> check value t path | _ -> fail ("has invalid type " ^ n))
      | None -> fail ("has unknown type " ^ n))
  | _ -> fail "has unsupported type"

let rec normalize env value schema =
  let schema=Surface_type_alias.resolve (Surface_type_alias.environment_lookup env) schema in
  match schema,value with
  | Ast.List (_,Ast.Symbol (_,"Option") :: [_]),Value.VMap entries when List.assoc_opt (Value.VKeyword ":_tag") entries=Some (Value.VString "None") -> Value.VNil
  | Ast.List (_,Ast.Symbol (_,"Option") :: [t]),Value.VMap entries when List.assoc_opt (Value.VKeyword ":_tag") entries=Some (Value.VString "Some") -> normalize env (Option.value ~default:Value.VNil (List.assoc_opt (Value.VKeyword ":value") entries)) t
  | Ast.Symbol (_,n),value -> (match Env.lookup ("__type/" ^ n) env with Some t -> (match Quote.syntax_of_value t with Ok t when t <> schema -> normalize env value t | _ -> value) | None -> value)
  | Ast.List (_,Ast.Symbol (_,"Union") :: arms),value -> (match List.find_opt (fun t -> errors env value t = []) arms with Some t -> normalize env value t | None -> value)
  | Ast.Map (_,fields),Value.VMap entries ->
      Value.VMap (List.filter_map (fun (key,value) ->
        let field = List.find_opt (fun (label,_) -> let label = Quote.value_of_syntax label in Value.equal label key) fields in
        match field with
        | Some (_,t) ->
            let absent = value=Value.VNil || (match value with Value.VMap fields -> List.assoc_opt (Value.VKeyword ":_tag") fields=Some (Value.VString "None") | _ -> false) in
            let value=normalize env value t in if Surface_type_alias.optional env t && absent then None else Some (key,value)
        | None -> Some (key,value)) entries)
  | Ast.List (_,Ast.Symbol (_,"Option") :: [t]),value when value <> Value.VNil -> normalize env value t
  | Ast.List (_,Ast.Symbol (_,"List") :: [t]),Value.VList values -> Value.VList (List.map (fun v -> normalize env v t) values)
  | Ast.List (_,Ast.Symbol (_,"List") :: [t]),Value.VVector values -> Value.VVector (List.map (fun v -> normalize env v t) values)
  | _ -> value

let rec runtime_expression = function
  | Value.VString text -> Value.VMap [Value.VString "$forma.runtimeExpr",Value.VString "string-literal";Value.VString "value",Value.VString text]
  | Value.VSymbol name -> Value.VString name
  | Value.VKeyword name -> Value.VString name
  | Value.VList values | Value.VVector values -> Value.VList (List.map runtime_expression values)
  | (Value.VMap entries | Value.VDictionary entries) -> Value.VMap (List.map (fun (k,v) -> k,runtime_expression v) entries)
  | value -> value

let rec project env value schema =
  let schema=Surface_type_alias.resolve (Surface_type_alias.environment_lookup env) schema in
  match schema,value with
  | Ast.Symbol (_,"Keyword"),Value.VKeyword n -> Value.VString (String.sub n 1 (String.length n-1))
  | Ast.Keyword (_,n),Value.VKeyword v when n=v -> Value.VString (String.sub n 1 (String.length n-1))
  | Ast.Symbol (_,"RuntimeExpr"),value -> Value.VMap [Value.VKeyword ":kind",Value.VString "raw-expr";Value.VKeyword ":expr",runtime_expression value]
  | Ast.Symbol (_,n),value -> (match Env.lookup ("__type/" ^ n) env with Some t -> (match Quote.syntax_of_value t with Ok t when t<>schema -> project env value t | _ -> value) | None -> value)
  | Ast.Map (_,fields),Value.VMap entries -> Value.VMap (List.map (fun (key,value) -> match List.find_opt (fun (k,_) -> Value.equal key (Quote.value_of_syntax k)) fields with Some (_,t) -> key,project env value t | None -> key,value) entries)
  | Ast.List (_,Ast.Symbol (_,"Option") :: [t]),value when value<>Value.VNil -> project env value t
  | Ast.List (_,Ast.Symbol (_,"List") :: [t]),(Value.VList values | Value.VVector values) -> Value.VList (List.map (fun v -> project env v t) values)
  | Ast.List (_,Ast.Symbol (_,"Map") :: [_;t]),Value.VMap entries -> Value.VMap (List.map (fun (k,v) -> k,project env v t) entries)
  | Ast.List (_,Ast.Symbol (_,"Union") :: arms),value -> (match List.find_opt (fun t -> errors env value t=[]) arms with Some t -> project env value t | None -> value)
  | _ -> value
