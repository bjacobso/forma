(* Typed form declarations derive the descriptor and executable projection together. *)
open Surface
(* Form grammar errors are reported at the authored form; stdlib exceptions
   are not authoring errors and are never converted here. *)
exception Form_error of string
let invalid_arg message = raise (Form_error message)
let text s value = Ast.String (s,value)
let clause s n args = Ast.List (s,kw s (":" ^ n) :: args)
let optional t = head t = Some "Option"
let unwrap = function Ast.List (_,Ast.Symbol (_,"Option") :: [t]) -> t | t -> t
let field_name e = match name e with Some n when String.starts_with ~prefix:":" n -> String.sub n 1 (String.length n-1) | _ -> invalid_arg "form :types keys must be keywords"

let parse expr = match expr with
  | Ast.List (s,Ast.Symbol (_,"form") :: Ast.List (_,id :: patterns) :: options) ->
      let form_name = Option.value ~default:"" (name id) in
      let doc,options = match options with Ast.String (_,doc) :: rest -> Some doc,rest | _ -> None,options in
      let rec pairs acc = function
        | [body] -> List.rev acc,body
        | Ast.Keyword (_,key) :: value :: rest when List.mem key [":types";":ir";":type";":scope";":check";":examples"] ->
            if List.mem_assoc key acc then invalid_arg ("Duplicate form option " ^ key);
            pairs ((key,value) :: acc) rest
        | _ -> invalid_arg "form expects :types, :ir, optional hooks and one projection body" in
      let options,body = pairs [] options in
      let types = match List.assoc_opt ":types" options with Some (Ast.Map (_,pairs)) -> List.map (fun (k,v)->field_name k,v) pairs | _ -> invalid_arg "form requires :types {:hole Type ...}" in
      let ir = match List.assoc_opt ":ir" options with Some (Ast.Symbol (_,ir)) -> ir | _ -> invalid_arg "form requires :ir IRType" in
      let seen = ref [] in
      let identifiers = ref [] and slots = ref [] and bindings = ref [] in
      let declarations = ref [] in
      let add positional many n =
        if List.mem n !seen then invalid_arg ("Duplicate form hole " ^ n);
        seen := n :: !seen;
        let t = match List.assoc_opt n types with Some t -> t | None -> invalid_arg ("Missing hole type " ^ n) in
        let u = unwrap t in
        let identifier = positional && (name u = Some "Symbol" || List.mem (Option.value ~default:"" (head u)) ["Declares";"Refers"]) in
        if identifier then (
          let declares = head u = Some "Declares" in
          if declares then (match u with Ast.List (_,[_;Ast.Symbol (_,n)]) -> declarations := n :: !declarations | _ -> invalid_arg "Declares expects a type");
          identifiers := !identifiers @ [call s "identifier" ([sym s n;sym s "Symbol"] @ if declares then [clause s "declaration" [Ast.Bool (s,true)]] else [])])
        else slots := !slots @ [call s "slot" ([sym s n;sym s (if head u = Some "Expr" then "expr" else "value")] @ (if optional t || many then [] else [clause s "required" [Ast.Bool (s,true)]]) @ (if many then [clause s "many" [Ast.Bool (s,true)]] else []) @ (match u with Ast.List (_, [Ast.Symbol (_,"Expr");t]) -> [clause s "type" [t]] | _ -> []))];
        let value = call s (if identifier then "meta/identifier" else if many then "meta/slot-values" else "meta/slot-value") [sym s "__form_input";text s n] in
        let value = if identifier then call s "sym" [value] else value in
        let value = match u with
          | Ast.List (_,[Ast.Symbol (_,"List");Ast.Symbol (_,child)]) when is_lower child -> call s "form/children" [text s child;value]
          | Ast.Symbol (_,child) when is_lower child -> call s "form/optional-child" [text s child;value]
          | _ -> value in
        let value = if head u = Some "Record" then
          let converted = call s "map" [call s "fn" [Ast.Vector (s,[sym s "__key"]);Ast.Vector (s,[sym s "__key";call s "meta/get" [value;sym s "__key"]])];call s "keys" [value]] in
          if optional t then call s "if" [call s "nil?" [value];sym s "nil";converted] else converted
          else value in
        bindings := !bindings @ [sym s n;value] in
      let rec pattern = function
        | [] -> ()
        | [Ast.Symbol (_,n);Ast.Symbol (_,"...")] -> add true true n
        | Ast.Map (_,[(Ast.Keyword (_,":keys"),Ast.Vector (_,keys))]) :: rest -> List.iter (function Ast.Symbol (_,n) -> add false false n | _ -> invalid_arg "Options pattern expects symbols") keys; pattern rest
        | Ast.Symbol (_,n) :: rest -> add true false n; pattern rest
        | _ -> invalid_arg "Unsupported form pattern" in
      pattern patterns;
      if List.length !seen <> List.length types then invalid_arg "Type for an unknown form hole";
      let holes = Ast.Map (s,List.map (fun (n,_)->kw s (":" ^ n),sym s n) types) in
      let bind expression = call s "let" [Ast.Vector (s,[sym s "__form_input";sym s "input"] @ !bindings @ [sym s "__holes";holes]);expression] in
      let result_type = match List.assoc_opt ":type" options with Some t when head t <> Some "fn" -> t | _ -> sym s (match !declarations with n :: _ -> n | [] -> "Unit") in
      let hook kind expression = call s "__form-hook" [sym s ("form/" ^ form_name ^ "/" ^ kind);clause s "kind" [sym s kind];clause s "input" [sym s "NormalizedForm"];clause s "output" [sym s (if kind = "construct" then ir else if kind = "validate" then "Diagnostics" else "Type")];clause s "body" [bind expression]] in
      let rec schema t = match t with
        | Ast.List (_, [Ast.Symbol (_,("Declares" | "Refers"));_]) -> call s "quote" [sym s "Symbol"]
        | Ast.List (_, [Ast.Symbol (_,"Expr");_]) -> call s "quote" [sym s "Syntax"]
        | Ast.List (_, [Ast.Symbol (_,"List");Ast.Symbol (_,child)]) when is_lower child -> call s "List" [call s "form/ir-type" [text s child]]
        | Ast.Symbol (_,child) when is_lower child -> call s "form/ir-type" [text s child]
        | Ast.List (_, [Ast.Symbol (_,(("List" | "Option" | "Record") as ctor));t]) -> call s "list" [call s "quote" [sym s ctor];schema t]
        | _ -> call s "quote" [t] in
      let checks = List.map (fun (n,t) -> call s "form/ensure" [sym s n;schema t]) types in
      let body = call s "do" (checks @ [call s "form/project" [body]]) in
      let result = call s "form/ensure" [body;call s "quote" [sym s ir]] in
      let descriptor = call s "__form-descriptor" ([id;clause s "phase" [sym s "domain"]] @ (match doc with None -> [] | Some doc -> [clause s "doc" [text s doc]]) @ [clause s "identifiers" !identifiers;clause s "slots" !slots;clause s "construct-fn" [sym s ("form/" ^ form_name ^ "/construct")];clause s "result-type" [call s "constant" [result_type]]] @ (if List.mem_assoc ":check" options then [clause s "validate-fn" [sym s ("form/" ^ form_name ^ "/validate")]] else []) @ (match List.assoc_opt ":type" options with Some t when head t = Some "fn" -> [clause s "result-type-fn" [sym s ("form/" ^ form_name ^ "/result-type")]] | _ -> [])) in
      let hooks = [hook "construct" result] @ (match List.assoc_opt ":check" options with Some fn -> [hook "validate" (Ast.List (s,[fn;sym s "__holes"]))] | None -> []) @ (match List.assoc_opt ":type" options with Some fn when head fn = Some "fn" -> [hook "result-type" (Ast.List (s,[fn;sym s "__holes"]))] | _ -> []) in
      Some (call s "define" [sym s ("__form.ir/" ^ form_name);call s "quote" [sym s ir]] :: call s "define" [sym s ("__form.options/" ^ form_name);call s "quote" [Ast.Map (s,List.map (fun (n,t)->kw s n,t) options)]] :: call s "define" [sym s ("__form.types/" ^ form_name);call s "quote" [Ast.Map (s,List.map (fun (n,t)->kw s (":" ^ n),t) types)]] :: call s "define" [sym s ("__form/" ^ form_name);call s "quote" [Ast.List (s,id :: patterns)]] :: hooks @ [descriptor])
  | Ast.List (_,Ast.Symbol (_,"form") :: _) -> invalid_arg "form requires (head pattern ...)"
  | _ -> None

let program exprs = List.concat_map (fun expr -> try match parse expr with Some definitions -> definitions | None -> [expr] with Form_error message -> raise (Surface.Invalid_form (Ast.expr_span expr,message))) exprs

let normalize_application_unchecked env form_name args =
  match Env.lookup ("__form/" ^ form_name) env with
  | None -> args
  | Some pattern ->
    let pattern = match Quote.syntax_of_value pattern with Ok (Ast.List (_, _ :: patterns)) -> patterns | _ -> [] in
    let rec match_ acc patterns args = match patterns,args with
      | [],[] -> List.rev acc
      | [Ast.Symbol (_,n);Ast.Symbol (_,"...")],args -> List.rev acc @ List.map (fun arg -> clause (Ast.expr_span arg) n [arg]) args
      | Ast.Map (_,[(Ast.Keyword (_,":keys"),Ast.Vector (_,keys))]) :: rest,args ->
          let allowed = List.filter_map name keys in
          let rec options acc = function
            | Ast.Keyword (s,n) :: value :: args -> let key = String.sub n 1 (String.length n-1) in if not (List.mem key allowed) then raise (Surface.Invalid_form (s,"Unknown option " ^ n ^ ". Available options: " ^ String.concat ", " (List.map (fun key->":" ^ key) allowed))); options (clause s key [value] :: acc) args
            | args -> match_ acc rest args in options acc args
      | Ast.Symbol (_,n) :: rest,value :: args ->
          let descriptor = Descriptor.form env form_name in
          let identifier = match descriptor with Some descriptor -> List.exists (fun (i:Descriptor.identifier_spec) -> i.name = n) descriptor.identifiers | _ -> false in
          match_ ((if identifier then value else clause (Ast.expr_span value) n [value]) :: acc) rest args
      | _ -> invalid_arg "Form arguments do not match their pattern" in
    match_ [] pattern args

let normalize_application ?span env form_name args =
  try normalize_application_unchecked env form_name args with Form_error message ->
    let span=match span,args with Some span,_ -> span | None,first :: _ -> Ast.expr_span first | None,[] -> {Ast.source_id="generated";start_offset=0;end_offset=0} in
    raise (Surface.Invalid_form (span,message))

(* Expected child IR determines the local namespace for an overloaded child head. *)
let child_family env family =
  Descriptor.is_form_descriptor env family || Env.lookup ("__type/" ^ family) env <> None

let resolve_child env family expr =
  let rec members seen value = match value with
    | Value.VSymbol n when not (List.mem n seen) -> (match Env.lookup ("__type/" ^ n) env with Some ((Value.VList _ | Value.VVector _) as alias) -> members (n :: seen) alias | _ -> [n])
    | Value.VList (Value.VSymbol "Union" :: arms) | Value.VVector (Value.VSymbol "Union" :: arms) -> List.concat_map (members seen) arms
    | _ -> [] in
  match Surface.head expr with
  | None -> None
  | Some child when Descriptor.is_form_descriptor env family -> if child = family then Some expr else None
  | Some child ->
      let allowed = Option.fold ~none:[] ~some:(members []) (Env.lookup ("__type/" ^ family) env) in
      List.find_map (fun candidate -> match Env.lookup ("__form.ir/" ^ candidate) env,expr with
        | Some (Value.VSymbol ir),Ast.List (s,head :: args) when List.mem ir allowed -> Some (Ast.List (s,Ast.Symbol (Ast.expr_span head,candidate) :: args))
        | _ -> None) [child;family ^ "/" ^ child]
