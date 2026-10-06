exception Ambiguous of Ast.span * string
(* Constructor qualification precedes checking and execution. *)
let name = function Ast.Symbol (_,n) | Ast.Keyword (_,n) -> Some n | _ -> None
let head = function Ast.List (_,h :: _) -> name h | _ -> None
let sym e n = Ast.Symbol (Ast.expr_span e,n)
let standard = ["Some","Option";"None","Option";"Ok","Result";"Err","Result"]
let rec owner_of_type = function
  | Some (Ast.List (_,Ast.Symbol (_,"Effect") :: success :: _)) -> owner_of_type (Some success)
  | Some (Ast.List (_,(Ast.Symbol (_,n)) :: _)) | Some (Ast.Symbol (_,n)) -> Some n | _ -> None
let result_of_type = function Some (Ast.List (_,Ast.Symbol (_,"->") :: args)) -> (match List.rev args with last :: _ -> Some last | [] -> None) | t -> t
let program expressions =
  let owners = Hashtbl.create 16 and payloads = Hashtbl.create 16 and aliases = Hashtbl.create 16 and signatures = Hashtbl.create 16 in
  let globals = ref [] in
  List.iter (function
    | Ast.List (_,Ast.Symbol (_,"__sum-type") :: Ast.List (_,Ast.Symbol (_,owner) :: _) :: arms) ->
        List.iter (function Ast.List (_,Ast.Symbol (_,ctor) :: fields) ->
          let previous=Option.value ~default:[] (Hashtbl.find_opt owners ctor) in
          Hashtbl.replace owners ctor (List.sort_uniq String.compare (owner :: previous));
          Hashtbl.replace payloads (owner ^ "." ^ ctor) fields | _ -> ()) arms
    | Ast.List (_,[Ast.Symbol (_,"__sum-type");Ast.Symbol (_,n);t]) -> Hashtbl.replace aliases n t
    | Ast.List (_,[((Ast.Symbol (_,":") | Ast.Keyword (_,":")));Ast.Symbol (_,n);t]) -> Hashtbl.replace signatures n t
    | Ast.List (_,Ast.Symbol (_,"define") :: Ast.Symbol (_,n) :: _) -> globals := (n,None) :: !globals
    | _ -> ()) expressions;
  Hashtbl.iter (fun n t -> globals := (n,Some t) :: List.remove_assoc n !globals) signatures;
  let rec alias seen = function Some (Ast.Symbol (_,n)) as t when not (List.mem n seen) -> (match Hashtbl.find_opt aliases n with Some t -> alias (n :: seen) (Some t) | None -> t) | t -> t in
  let qualify bindings expected expression = match name expression with
    | Some n when not (String.contains n '.') && not (List.mem_assoc n bindings) ->
        let candidates=Option.value ~default:[] (Hashtbl.find_opt owners n) in
        let expected_owner=owner_of_type expected in
        let owner=match expected_owner with
          | Some owner when List.mem owner candidates || List.assoc_opt n standard=Some owner -> Some owner
          | _ -> (match candidates with [owner] -> Some owner | _ -> None) in
        (match owner,candidates with
         | Some owner,_ -> sym expression (owner ^ "." ^ n)
         | None,_ :: _ :: _ -> raise (Ambiguous (Ast.expr_span expression, "Ambiguous constructor " ^ n ^ "; use Type." ^ n ^ " or provide an expected type"))
         | _ -> expression)
    | _ -> expression in
  let owner_symbol e n = if String.contains n '.' then sym e (String.sub n 0 (String.rindex n '.')) else sym e n in
  let type_of bindings expression =
    let n=match name expression with Some _ as n -> n | None -> head expression in
    match n with
    | Some n when List.mem_assoc n bindings -> (match expression with Ast.List _ -> result_of_type (List.assoc n bindings) | _ -> List.assoc n bindings)
    | Some n when String.contains n '.' -> Some (owner_symbol expression n)
    | Some n -> (match Hashtbl.find_opt owners n with Some [owner] -> Some (sym expression owner) | _ -> Option.map (sym expression) (List.assoc_opt n standard))
    | None -> None in
  let rec pattern expected = function
    | Ast.Symbol _ as p -> qualify [] expected p
    | Ast.List (s,ctor :: fields) ->
        let ctor=qualify [] expected ctor in
        let hints=Option.value ~default:[] (Option.bind (name ctor) (Hashtbl.find_opt payloads)) in
        Ast.List (s,ctor :: List.mapi (fun i p -> pattern (List.nth_opt hints i) p) fields)
    | p -> p in
  let rec visit bindings expected expression = match expression with
    | Ast.Symbol _ -> qualify bindings expected expression
    | Ast.Map (s,fields) ->
        let expected=match alias [] expected with Some (Ast.Map (_,fields)) -> fields | _ -> [] in
        Ast.Map (s,List.map (fun (k,v) -> k,visit bindings (Option.map snd (List.find_opt (fun (key,_) -> (match key,k with Ast.String (_,a),Ast.String (_,b) -> a=b | _ -> name key<>None && name key=name k)) expected)) v) fields)
    | Ast.Vector (s,items) ->
        let expected=match alias [] expected with Some (Ast.List (_,[Ast.Symbol (_,"List");t])) -> Some t | _ -> None in
        Ast.Vector (s,List.map (visit bindings expected) items)
    | Ast.List (_,Ast.Symbol (_, ("quote" | "quasiquote" | "__sum-type" | "__schema")) :: _) -> expression
    | Ast.List (s,[((Ast.Symbol (_,":") | Ast.Keyword (_,":")) as h);value;t]) ->
        let value=match name value with Some n when List.mem_assoc n bindings -> value | _ -> visit bindings (Some t) value in Ast.List (s,[h;value;t])
    | Ast.List (s,[Ast.Symbol (_,"define") as h;Ast.Symbol (_,n) as id;value]) -> Ast.List (s,[h;id;visit bindings (Hashtbl.find_opt signatures n) value])
    | Ast.List (s,(Ast.Symbol (_,"fn") as h) :: (Ast.Vector (_,params) as parameters) :: bodies) ->
        let expected=alias [] expected in
        let hints=match expected with Some (Ast.List (_,Ast.Symbol (_,"->") :: args)) -> List.rev args |> List.tl |> List.rev | _ -> [] in
        let bindings=List.mapi (fun i p -> name p,List.nth_opt hints i) params |> List.fold_left (fun env (n,t) -> match n with Some n -> (n,t) :: List.remove_assoc n env | None -> env) bindings in
        Ast.List (s,h :: parameters :: tails bindings (result_of_type expected) bodies)
    | Ast.List (s,(Ast.Symbol (_,"let") as h) :: Ast.Vector (vs,values) :: bodies) ->
        let rec bind env = function
          | binder :: value :: rest -> let value=visit env None value in let env=match name binder with Some n -> (n,type_of env value) :: List.remove_assoc n env | None -> env in
              let values,env=bind env rest in binder :: value :: values,env
          | values -> values,env in
        let values,bindings=bind bindings values in Ast.List (s,h :: Ast.Vector (vs,values) :: tails bindings expected bodies)
    | Ast.List (s,(Ast.Symbol (_,"match") as h) :: value :: arms) ->
        let value=visit bindings None value in
        let rec patterns = function p :: body :: rest -> pattern (type_of bindings value) p :: visit bindings expected body :: patterns rest | rest -> rest in
        Ast.List (s,h :: value :: patterns arms)
    | Ast.List (s,(Ast.Symbol (_,"if") as h) :: condition :: branches) -> Ast.List (s,h :: visit bindings None condition :: List.map (visit bindings expected) branches)
    | Ast.List (s,(Ast.Symbol (_,"do") as h) :: bodies) -> Ast.List (s,h :: tails bindings expected bodies)
    | Ast.List (s,callee :: args) ->
        let ctor=qualify bindings expected callee in
        let hints=match Option.bind (name ctor) (Hashtbl.find_opt payloads) with Some fields -> fields | None ->
          (match Option.bind (name callee) (fun n -> List.assoc_opt n bindings) |> Option.join with Some (Ast.List (_,Ast.Symbol (_,"->") :: args)) -> List.rev args |> List.tl |> List.rev | _ -> []) in
        Ast.List (s,ctor :: List.mapi (fun i arg -> visit bindings (List.nth_opt hints i) arg) args)
    | _ -> expression
  and tails bindings expected bodies = List.mapi (fun i body -> visit bindings (if i=List.length bodies-1 then expected else None) body) bodies in
  List.map (visit !globals None) expressions
