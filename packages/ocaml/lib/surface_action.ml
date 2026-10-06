(* An Action signature selects the ontology runtime projection. *)
let name = function Ast.Symbol (_,n) | Ast.Keyword (_,n) -> Some n | _ -> None
let head = function Ast.List (_,h :: _) -> name h | _ -> None
let sym s n = Ast.Symbol (s,n)
let call s n args = Ast.List (s,sym s n :: args)
let invalid = Surface_error.invalid
let program ?(known_actions=[]) exprs =
  let entity_fields = List.filter_map (function Ast.List (_,Ast.Symbol (_,"entity") :: Ast.Symbol (_,n) :: Ast.Map (_,fields) :: _) -> Some (n,fields) | _ -> None) exprs in
  let located=List.filter_map (function
    | Ast.List (s,[(Ast.Symbol (_,":") | Ast.Keyword (_,":"));Ast.Symbol (_,n);signature]) ->
        let parts=match signature with Ast.List (_,Ast.Symbol (_,"->") :: parts) -> parts | t -> [t] in
        (match List.rev parts with Ast.List (_, [Ast.Symbol (_,"Action");result]) :: inputs -> Some (s,(n,(List.rev inputs,result))) | _ -> None)
    | _ -> None) exprs in
  let signatures=List.map snd located in
  List.iter (fun (s,(n,_)) ->
    if List.length (List.filter (fun (id,_)->id=n) signatures)<>1 then invalid s ("Duplicate Action signature " ^ n);
    let definitions=List.filter (function Ast.List (_,Ast.Symbol (_,"define") :: Ast.Symbol (_,id) :: _) -> id=n | _ -> false) exprs in
    match definitions with [_] -> () | _ :: second :: _ -> invalid (Ast.expr_span second) ("Action " ^ n ^ " requires exactly one definition") | [] -> invalid s ("Action " ^ n ^ " requires exactly one definition")) located;
  List.map (function
    | Ast.List (s,[(Ast.Symbol (_,":") | Ast.Keyword (_,":"));Ast.Symbol (_,n);_]) when List.mem_assoc n signatures -> call s "do" []
    | Ast.List (s,Ast.Symbol (_,"define") :: (Ast.Symbol (_,n) as id) :: tail) as expr when List.mem_assoc n signatures ->
        let inputs,result=List.assoc n signatures in
        let params,bodies=match tail with Ast.Vector (_,params) :: bodies -> params,bodies | [Ast.List (_,Ast.Symbol (_,"fn") :: Ast.Vector (_,params) :: bodies)] -> params,bodies | bodies -> [],bodies in
        if List.length params <> List.length inputs || List.length (List.sort_uniq String.compare (List.filter_map name params))<>List.length params || List.exists (function Ast.Symbol (_,n) when String.length n>0 && n.[0]>='a' && n.[0]<='z' -> false | _ -> true) params then invalid s ("Action " ^ n ^ " parameters must match its signature");
        let body=match bodies with [] -> invalid s ("Action " ^ n ^ " requires a body") | [body] -> body | bodies -> call s "do" bodies in
        let rec value_type locals = function
          | Ast.Symbol (s,n) -> (match List.assoc_opt n locals with Some t -> Some t | None ->
              (match String.rindex_opt n '.' with None -> None | Some dot ->
                let base=String.sub n 0 dot and field=String.sub n (dot+1) (String.length n-dot-1) in
                match List.assoc_opt base locals with
                | Some (Ast.Symbol (_,entity) as t) when List.mem_assoc entity entity_fields ->
                    if field="id" then Some (call s "Id" [t]) else List.find_map (fun (k,t)->if name k=Some (":" ^ field) then Some t else None) (List.assoc entity entity_fields)
                | Some (Ast.Map (_,fields)) -> List.find_map (fun (k,t)->if name k=Some (":" ^ field) then Some t else None) fields
                | _ -> None))
          | Ast.List (s,[Ast.Symbol (_,"create!");entity;_]) -> Some (call s "Id" [entity])
          | Ast.List (_,[(Ast.Symbol (_,":") | Ast.Keyword (_,":"));_;t]) -> Some t
          | Ast.List (s,[Ast.Symbol (_,"get");v;key]) ->
              (match value_type locals v,name key with Some (Ast.Symbol (_,entity) as t),Some (":id" | "id") when List.mem_assoc entity entity_fields -> Some (call s "Id" [t]) | _ -> None)
          | Ast.List (_,Ast.Symbol (_,callee) :: _) -> Option.map (fun (_,result)->result) (List.assoc_opt callee signatures)
          | _ -> None in
        let rec pattern_names = function
          | Ast.Symbol (_,n) when String.length n>0 && n.[0]>='a' && n.[0]<='z' -> [n]
          | Ast.Map (_,fields) -> List.concat_map (fun (_,v)->pattern_names v) fields
          | Ast.List (_,items) | Ast.Vector (_,items) -> List.concat_map pattern_names items
          | _ -> [] in
        let rec normalize locals = function
          | Ast.List (_,Ast.Symbol (_,("quote" | "quasiquote")) :: _) as e -> e
          | Ast.Map (s,pairs) -> Ast.Map (s,List.map (fun (k,v)->k,normalize locals v) pairs)
          | Ast.Vector (s,items) -> Ast.Vector (s,List.map (normalize locals) items)
          | Ast.List (s,Ast.Symbol (_,(("update!" | "retract!") as op)) :: id :: args) when List.length args=(if op="update!" then 1 else 0) ->
              (match value_type locals id with
               | Some (Ast.List (_,[Ast.Symbol (_,"Id");(Ast.Symbol _ as entity)])) -> call s op (entity :: List.map (normalize locals) (id :: args))
               | _ -> invalid (Ast.expr_span id) (op ^ " requires an Id with a known entity type"))
          | Ast.List (s,Ast.Symbol (_,(("do!" | "let") as op)) :: Ast.Vector (bs,bindings) :: bodies) ->
              let rec sequence locals = function
                | [] -> [],locals
                | Ast.Keyword (_,":let") :: Ast.Vector (vs,items) :: rest when op="do!" ->
                    let items,locals=sequence locals items in let rest,locals=sequence locals rest in Ast.Keyword (vs,":let") :: Ast.Vector (vs,items) :: rest,locals
                | binding :: value :: rest ->
                    let t=value_type locals value in let value=normalize locals value in
                    let locals=List.filter (fun (n,_)->not (List.mem n (pattern_names binding))) locals in
                    let locals=match binding,t with Ast.Symbol (_,n),Some t -> (n,t)::locals | _ -> locals in
                    let rest,locals=sequence locals rest in binding :: value :: rest,locals
                | _ -> invalid bs (op ^ " requires binding/value pairs") in
              let bindings,locals=sequence locals bindings in call s op (Ast.Vector (bs,bindings) :: List.map (normalize locals) bodies)
          | Ast.List (s,Ast.Symbol (_,"fn") :: (Ast.Vector (_,params) as p) :: bodies) ->
              let names=List.concat_map pattern_names params in
              call s "fn" (p :: List.map (normalize (List.filter (fun (n,_)->not (List.mem n names)) locals)) bodies)
          | Ast.List (s,Ast.Symbol (_,"match") :: value :: arms) ->
              let rec cases = function
                | [] -> []
                | pattern :: body :: rest -> let names=pattern_names pattern in pattern :: normalize (List.filter (fun (n,_)->not (List.mem n names)) locals) body :: cases rest
                | _ -> invalid s "match requires pattern/body pairs" in
              call s "match" (normalize locals value :: cases arms)
          | Ast.List (s,items) -> Ast.List (s,List.map (normalize locals) items)
          | e -> e in
        let body=normalize (List.map2 (fun p t -> Option.get (name p),t) params inputs) body in
        let entities=ref [] and relations=ref [] and documents=ref [] and calls=ref [] in
        let remember entries n value = if not (List.mem_assoc n !entries) then entries := !entries @ [n,value] in
        let rec check = function
          | Ast.Map (s,pairs) -> Ast.Map (s,List.map (fun (k,v)->k,check v) pairs)
          | Ast.Vector (s,items) -> Ast.Vector (s,List.map check items)
          | Ast.List (_,Ast.Symbol (_,("quote" | "quasiquote")) :: _) as e -> e
          | Ast.List (s,Ast.Symbol (_,"link!") :: (Ast.Symbol (_,relation) as id) :: [source;target;fields]) ->
              remember relations relation id;
              call s ("__action.link/" ^ relation) (List.map check [source;target;fields])
          | Ast.List (s,[Ast.Symbol (_,"instantiate!"); (Ast.Symbol (_,document) as doc);(Ast.Symbol (_,entity) as owner);id]) ->
              remember documents document doc; remember entities entity owner;
              call s ("__action.instantiate/" ^ entity) [call s "quote" [doc];check id]
          | Ast.List (s,[Ast.Symbol (_,"task!");(Ast.Symbol (_,entity) as owner);fields]) ->
              remember entities entity owner; call s ("__action.task/" ^ entity) [check fields]
          | Ast.List (s,Ast.Symbol (_,(("create!" | "update!" | "retract!") as op)) :: entity :: args) ->
              let owner=match entity with Ast.Symbol (_,n) -> n | _ -> invalid (Ast.expr_span entity) (op ^ " requires an entity symbol") in
              let arity=if op="update!" then 2 else 1 in
              if List.length args<>arity then invalid s (op ^ " has " ^ string_of_int (arity+1) ^ " arguments");
              if not (List.mem_assoc owner !entities) then entities := !entities @ [owner,entity];
              call s ("__action." ^ String.sub op 0 (String.length op-1) ^ "/" ^ owner) (List.map check args)
          | Ast.List (s,Ast.Symbol (_,"do!") :: Ast.Vector (bs,bindings) :: bodies) ->
              call s "do!" (Ast.Vector (bs,List.mapi (fun i value -> if i mod 2=1 then check value else value) bindings) :: List.map check bodies)
          | Ast.List (s,(Ast.Symbol (_,callee) as id) :: args) when List.mem_assoc callee signatures || List.mem callee known_actions -> remember calls callee id; Ast.List (s,id :: List.map check args)
          | Ast.List (s,items) -> Ast.List (s,List.map check items)
          | e -> e in
        let checked=call s "do!" [Ast.Vector (s,[]);check body] in
        let effect=call s "Effect" [result;Ast.Vector (s,[]);Ast.Vector (s,[sym s "OntologyRuntime"])] in
        let fields=Ast.Map (s,List.map2 (fun p t -> Ast.Keyword (Ast.expr_span p,":" ^ Option.get (name p)),t) params inputs) in
        let _ = expr in
        call s "__action" [id;fields;result;effect;body;checked;Ast.Vector (s,List.map snd !entities);Ast.Vector (s,List.map snd !relations);Ast.Vector (s,List.map snd !documents);Ast.Vector (s,List.map snd !calls)]
    | expr -> expr) exprs
