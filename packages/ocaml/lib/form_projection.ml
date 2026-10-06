(* Compile structural form bodies into native plans. Unsupported expressions use
   the ordinary evaluator; classification depends on syntax, never domain heads. *)
type diagnostic = Eval_common.diagnostic

type primitive = Env.t -> string -> Value.t list -> (Value.t,diagnostic list) result
type plan = primitive -> Env.t -> (Value.t,diagnostic list) result
let primitive_names = ["get";"get-in";"assoc";"dissoc";"merge";"list";"vector";
  "concat";"conj";"str";"keyword";"keyword/name";"sym";"count";"empty?";"nil?";
  "first";"nth";"rest";"meta/get";"keys";"values";"not";"=";"contains?"]
let rec sequence compile = function
  | [] -> Some []
  | expr :: rest -> Option.bind (compile expr) (fun plan -> Option.map (fun rest->plan :: rest) (sequence compile rest))
let rec run_all primitive env = function
  | [] -> Ok []
  | plan :: rest -> (match plan primitive env with Error _ as error -> error | Ok value ->
      run_all primitive env rest |> Result.map (fun rest -> value :: rest))
let rec compile : Ast.expr -> plan option = function
  | Ast.Nil _ -> Some (fun _ _ -> Ok Value.VNil)
  | Ast.Bool (_,value) -> Some (fun _ _ -> Ok (Value.VBool value))
  | Ast.Int (_,value) -> Some (fun _ _ -> Ok (Value.VInt value))
  | Ast.Float (_,value) -> Some (fun _ _ -> Ok (Value.VFloat value))
  | Ast.String (_,value) -> Some (fun _ _ -> Ok (Value.VString value))
  | Ast.Keyword (_,value) -> Some (fun _ _ -> Ok (Value.VKeyword value))
  | Ast.Symbol (_,name) -> Some (fun primitive env -> match Env.lookup name env with
      | Some value -> Ok value
      | None -> primitive env "__symbol" [Value.VSymbol name])
  | Ast.Vector (_,items) -> Option.map (fun plans primitive env -> run_all primitive env plans |> Result.map (fun values -> Value.VList values)) (sequence compile items)
  | Ast.Map (_,fields) ->
      Option.map (fun plans primitive env ->
        run_all primitive env plans |> Result.map (fun values ->
          let rec pairs = function key :: value :: rest -> (key,value) :: pairs rest | _ -> [] in
          Value.VMap (pairs values))) (sequence compile (List.concat_map (fun (key,value)->[key;value]) fields))
  | Ast.List (_, [Ast.Symbol (_,"quote");value]) -> Some (fun _ _ -> Ok (Quote.value_of_syntax value))
  | Ast.List (_, [Ast.Symbol (_,"map");Ast.List (_, [Ast.Symbol (_,"fn");Ast.Vector (_, [Ast.Symbol (_,name)]);body]);items]) ->
      (match compile body,compile items with
       | Some body,Some items -> Some (fun primitive env ->
           match items primitive env with
           | Error _ as error -> error
           | Ok ((Value.VList values | Value.VVector values) as collection) ->
               let rec loop = function
                 | [] -> Ok []
                 | value :: rest -> (match body primitive (Env.bind name value env) with
                     | Error _ as error -> error
                     | Ok value -> loop rest |> Result.map (fun rest->value :: rest)) in
               loop values |> Result.map (fun values->match collection with Value.VVector _ -> Value.VVector values | _ -> Value.VList values)
           | Ok _ -> Error [Eval_common.diagnostic "eval/expected-list" "map expects a list or vector"])
       | _ -> None)
  | Ast.List (_,Ast.Symbol (_,"or") :: items) ->
      Option.map (fun plans primitive env ->
        let rec loop last = function
          | [] -> Ok last
          | plan :: rest -> match plan primitive env with
              | Error _ as error -> error
              | Ok value when Value.truthy value -> Ok value
              | Ok value -> loop value rest in loop Value.VNil plans) (sequence compile items)
  | Ast.List (_, [Ast.Symbol (_,"if");condition;yes;no]) ->
      (match compile condition,compile yes,compile no with
       | Some condition,Some yes,Some no -> Some (fun primitive env ->
           match condition primitive env with Error _ as error -> error | Ok value -> (if Value.truthy value then yes else no) primitive env)
       | _ -> None)
  | Ast.List (_, Ast.Symbol (_,"let") :: Ast.Vector (_,bindings) :: bodies) ->
      let rec pairs = function
        | [] -> Some []
        | Ast.Symbol (_,name) :: expr :: rest -> Option.bind (compile expr) (fun plan -> Option.map (fun rest -> (name,plan) :: rest) (pairs rest))
        | _ -> None in
      (match pairs bindings,sequence compile bodies with
       | Some bindings,Some bodies -> Some (fun primitive env ->
           let rec bind env = function
             | [] -> run_all primitive env bodies |> Result.map (fun values->match List.rev values with value :: _ -> value | [] -> Value.VNil)
             | (name,plan) :: rest -> match plan primitive env with Error _ as error -> error | Ok value -> bind (Env.bind name value env) rest in
           bind env bindings)
       | _ -> None)
  | Ast.List (_,Ast.Symbol (_,name) :: args) when List.mem name primitive_names ->
      Option.map (fun plans primitive env -> match run_all primitive env plans with
        | Error _ as error -> error | Ok values ->
            let operation = if name="get" && (match List.nth_opt args 1 with Some (Ast.Keyword _ | Ast.String _ | Ast.Int _) -> false | _ -> true) then "__map-get" else name in
            primitive env operation values) (sequence compile args)
  | _ -> None

let rec can_run env = function
  | Ast.List (_, [Ast.Symbol (_,"quote");_]) -> true
  | Ast.List (_,Ast.Symbol (_,"let") :: Ast.Vector (_,bindings) :: bodies) ->
      let rec bind env = function
        | [] -> List.for_all (can_run env) bodies
        | Ast.Symbol (_,n) :: value :: rest -> can_run env value && bind (Env.bind n Value.VNil env) rest
        | _ -> false in
      bind env bindings
  | Ast.List (_,Ast.Symbol (_,"fn") :: Ast.Vector (_,params) :: bodies) ->
      let names=List.filter_map (function Ast.Symbol (_,n)->Some n | _->None) params in
      List.for_all (can_run (List.fold_left (fun env n->Env.bind n Value.VNil env) env names)) bodies
  | Ast.List (_, Ast.Symbol (_,name) :: args) ->
      (not (List.mem name ("map" :: primitive_names)) || Env.lookup name env=None)
      && List.for_all (can_run env) args
  | Ast.Map (_,fields) -> List.for_all (fun (key,value)->can_run env key && can_run env value) fields
  | Ast.Vector (_,items) -> List.for_all (can_run env) items
  | _ -> true

let cache : (Ast.expr,plan option) Hashtbl.t = Hashtbl.create 64
let cached expr = match Hashtbl.find_opt cache expr with
  | Some plan -> plan
  | None ->
      if Hashtbl.length cache >= 512 then Hashtbl.clear cache;
      let plan=compile expr in Hashtbl.replace cache expr plan; plan
