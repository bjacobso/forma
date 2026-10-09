open Module_contract
include Module_compile_time_syntax

let prepare (m : resolved_module) owner_of =
  let visible = List.map snd (m.bindings @ m.imports) @ m.namespace_imports in
  let imported =
    List.filter (fun (b : binding) -> b.identity.module_id <> m.id) visible
  in
  let env = ref Env.empty
  and origins = Hashtbl.create 16
  and ready = Hashtbl.create 16
  and demanding = ref [] in
  let definitions =
    List.filter_map
      (function
        | Ast.List (_, Ast.Symbol (_, "define") :: Ast.Symbol (_, n) :: _) as e
          ->
            Some (n, e)
        | _ -> None)
      m.expressions
  in
  let local_types =
    List.filter_map
      (function
        | Ast.List (_, Ast.Symbol (_, "type") :: Ast.Symbol (_, n) :: t :: _) ->
            Some (n, t)
        | _ -> None)
      m.expressions
  in
  let types =
    local_types
    @ List.filter_map
        (fun (b : binding) ->
          Option.bind (owner_of b.identity) (fun m ->
              Option.bind m.compile_time (fun state ->
                  Option.map
                    (fun t -> (b.symbol, t))
                    (List.assoc_opt b.symbol state.types))))
        imported
  in
  let get_owner (b : binding) =
    match owner_of b.identity with
    | Some { compile_time = Some state; _ } -> state
    | _ ->
        fail (List.hd m.expressions) "module/compile-time-data"
          ("No compile-time data for " ^ b.name)
  in
  let evaluate environment expressions =
    match Eval.evaluate_program_with_env environment expressions with
    | Ok result -> result
    | Error (d :: _) ->
        raise
          (Error
             (Type_diagnostic.make ?span:d.Eval.span "module/compile-time-data"
                d.message))
    | Error [] -> assert false
  in
  List.iter
    (fun (b : binding) ->
      let owner = get_owner b in
      if
        b.kind = "form" || b.kind = "macro"
        || List.mem b.kind [ "type"; "class"; "error" ]
      then
        let names =
          [
            b.symbol;
            "__type/" ^ b.symbol;
            "__type-kind/" ^ b.symbol;
            "__constructor/" ^ b.symbol;
            "__descriptor/" ^ b.symbol;
            "__form/" ^ b.symbol;
            "__form.ir/" ^ b.symbol;
            "__form.types/" ^ b.symbol;
            "__form.options/" ^ b.symbol;
            "form/" ^ b.symbol ^ "/construct";
            "form/" ^ b.symbol ^ "/validate";
            "form/" ^ b.symbol ^ "/result-type";
          ]
        in
        List.iter
          (fun (n, v) -> if List.mem n names then env := Env.bind n v !env)
          (Env.visible_bindings (owner.environment ())))
    imported;
  let metadata =
    List.filter
      (function
        | Ast.List
            ( _,
              Ast.Symbol (_, ("type" | "class" | "error" | "form" | "macro"))
              :: _ ) ->
            true
        | Ast.List (_, Ast.Symbol (_, "define") :: _ :: Ast.Vector _ :: _ :: _)
          ->
            true
        | Ast.List
            ( _,
              [
                Ast.Symbol (_, "define");
                _;
                Ast.List (_, Ast.Symbol (_, "fn") :: _);
              ] ) ->
            true
        | _ -> false)
      m.expressions
  in
  let _, metadata_env = evaluate !env metadata in
  env := metadata_env;
  List.iter
    (fun (n, _) ->
      match Env.lookup n !env with
      | Some (Value.VClosure _) -> Hashtbl.replace ready n ()
      | _ -> ())
    definitions;
  let local_forms =
    List.filter_map
      (function
        | Ast.List
            ( _,
              Ast.Symbol (_, "form")
              :: Ast.List (_, Ast.Symbol (_, n) :: _)
              :: _ ) as e ->
            Some (n, e)
        | _ -> None)
      m.expressions
  in
  let imported_forms =
    List.concat_map
      (fun (b : binding) ->
        if b.kind = "form" || b.kind = "macro" then (get_owner b).forms ()
        else [])
      imported
    |> List.sort_uniq (fun (a, _) (b, _) -> String.compare a b)
  in
  let applications =
    List.filter_map
      (fun (_, (b : binding)) ->
        match b.declaration with
        | None -> None
        | Some d ->
            List.find_opt
              (fun expression ->
                match head expression with
                | Some h ->
                    h = symbol d.form
                    && List.exists
                         (fun (_, value) -> name value = Some b.symbol)
                         (match_holes
                            (match List.assoc_opt h local_forms with
                            | Some d -> d
                            | None -> (List.assoc h imported_forms).definition)
                            expression)
                | None -> false)
              m.expressions
            |> Option.map (fun e -> (b.symbol, e)))
      m.bindings
  in
  let applications =
    applications
    @ (m.expressions
      |> List.mapi (fun index expression -> (index, expression))
      |> List.filter_map (fun (index, expression) ->
             if
               List.mem_assoc
                 (Option.value ~default:"" (head expression))
                 (local_forms
                 @ List.map (fun (n, f) -> (n, f.definition)) imported_forms)
               && not (List.exists (fun (_, e) -> e = expression) applications)
             then Some ("@application_" ^ string_of_int index, expression)
             else None))
  in
  let rec collect = function
    | Ast.Symbol (_, n) -> [ n ]
    | Ast.List (_, Ast.Symbol (_, ("quote" | "quasiquote")) :: _) -> []
    | Ast.List (_, xs) | Ast.Vector (_, xs) -> List.concat_map collect xs
    | Ast.Map (_, pairs) ->
        List.concat_map (fun (k, v) -> collect k @ collect v) pairs
    | _ -> []
  in
  let rec state =
    {
      environment = (fun () -> !env);
      read;
      forms =
        (fun () ->
          List.map
            (fun (n, definition) ->
              ( n,
                {
                  definition;
                  owner = state;
                  form_identity =
                    (List.find
                       (fun (_, (b : binding)) -> b.symbol = n)
                       m.bindings
                    |> snd)
                      .identity;
                } ))
            local_forms
          @ imported_forms);
      types;
      origins;
    }
  and materialize expression =
    let seen = Hashtbl.create 8 in
    let rec visit n =
      if not (Hashtbl.mem seen n) then (
        Hashtbl.add seen n ();
        if
          List.mem_assoc n definitions
          || List.mem_assoc n applications
          || List.exists
               (fun (b : binding) ->
                 b.symbol = n
                 && List.mem b.kind [ "value"; "declaration"; "macro" ])
               imported
        then (
          if (not (Hashtbl.mem ready n)) && not (List.mem n !demanding) then
            ignore (read n);
          match (List.assoc_opt n definitions, Env.lookup n !env) with
          | Some definition, Some (Value.VClosure _) ->
              List.iter visit (collect definition)
          | _ -> ()))
    in
    List.iter visit (collect expression)
  and run expression =
    let expanded =
      match Eval.expand_program_with_env !env [ expression ] with
      | Ok (xs, _) -> xs
      | Error (d :: _) ->
          raise
            (Error (Type_diagnostic.make ?span:d.Eval.span d.code d.message))
      | Error [] -> assert false
    in
    List.iter
      (fun e ->
        List.iter
          (fun symbol ->
            if contains symbol "__forma_" && Env.lookup symbol !env = None then
              List.iter
                (fun (b : binding) ->
                  if b.kind = "macro" then
                    let owner = get_owner b in
                    match Env.lookup symbol (owner.environment ()) with
                    | Some _ -> env := Env.bind symbol (owner.read symbol) !env
                    | None -> ())
                imported)
          (collect e);
        materialize e)
      expanded;
    fst (evaluate !env expanded)
  and read n =
    if Hashtbl.mem ready n then
      match (Env.lookup n !env, List.assoc_opt n definitions) with
      | Some (Value.VClosure closure), Some definition ->
          materialize definition;
          let binding = List.find (fun (b : binding) -> b.symbol = n) visible in
          let inputs =
            collect definition
            |> List.filter (fun name -> name <> n)
            |> List.concat_map (fun name ->
                   Option.value ~default:[] (Hashtbl.find_opt origins name))
          in
          Hashtbl.replace origins n
            (origin binding.identity definition :: inputs);
          let rec self =
            Value.VClosure
              { closure with env = (n, self) :: Env.visible_bindings !env }
          in
          env := Env.bind n self !env;
          self
      | Some value, _ -> value
      | _ -> Value.VNil
    else
      let expression = List.assoc_opt n (definitions @ applications) in
      if List.mem n !demanding then
        fail (Option.get expression) "module/data-cycle"
          ("Compile-time data cycle: "
          ^ String.concat " -> " (!demanding @ [ n ])
          ^ ".");
      demanding := !demanding @ [ n ];
      Fun.protect
        ~finally:(fun () ->
          demanding := List.rev (List.tl (List.rev !demanding)))
        (fun () ->
          let binding =
            List.find_opt (fun (b : binding) -> b.symbol = n) visible
          in
          let value =
            match (binding, expression) with
            | Some b, _ when b.identity.module_id <> m.id ->
                let owner = get_owner b in
                let value = owner.read n in
                Hashtbl.replace origins n
                  (Option.value ~default:[] (Hashtbl.find_opt owner.origins n));
                value
            | _, Some expression when List.mem_assoc n applications -> (
                let form =
                  List.assoc (Option.get (head expression)) (state.forms ())
                in
                let patterns, holes, options, body =
                  form_parts form.definition
                in
                ignore patterns;
                List.iter
                  (fun dependency ->
                    if
                      (not (List.mem_assoc dependency holes))
                      && (List.mem_assoc dependency
                            (List.map (fun (n, _) -> (n, ())) m.bindings)
                         || contains dependency "__forma_")
                    then
                      try ignore (form.owner.read dependency)
                      with Not_found -> ())
                  (List.concat_map collect (body :: List.map snd options));
                let authored_holes = match_holes form.definition expression in
                materialize expression;
                let converted =
                  List.map
                    (fun (hole, t) ->
                      match List.assoc_opt hole authored_holes with
                      | None -> (hole, Value.VNil)
                      | Some value ->
                          ( hole,
                            if is_syntax t then Quote.value_of_syntax value
                            else run value ))
                    holes
                in
                let caller = Env.visible_bindings !env in
                let _, linked_scope =
                  evaluate (form.owner.environment ()) [ form.definition ]
                in
                let validation_env = Env.extend caller linked_scope in
                let args =
                  match expression with
                  | Ast.List (_, _ :: args) ->
                      Surface_form.normalize_application validation_env
                        (Option.get (head expression))
                        args
                  | _ -> []
                in
                let args =
                  List.map
                    (function
                      | Ast.List (s, [ (Ast.Keyword (_, key) as k); _ ]) as arg
                        -> (
                          let hole = String.sub key 1 (String.length key - 1) in
                          match
                            ( List.assoc_opt hole converted,
                              List.assoc_opt hole holes )
                          with
                          | Some value, Some t when not (is_syntax t) ->
                              Ast.List
                                ( s,
                                  [
                                    k;
                                    (match Quote.syntax_of_value value with
                                    | Ok e -> e
                                    | Error _ ->
                                        fail expression
                                          "module/compile-time-data"
                                          "Value is not inspectable pure data.");
                                  ] )
                          | _ -> arg)
                      | arg -> arg)
                    args
                in
                let declaration =
                  Descriptor.application_value
                    (Option.get (head expression))
                    args
                in
                (match
                   Form_semantics.validate ~syntax:expression
                     ~span:(Ast.expr_span expression) validation_env declaration
                 with
                | Ok _ -> ()
                | Error (d :: _) ->
                    raise
                      (Error
                         (Type_diagnostic.make ?span:d.Eval_common.span d.code
                            d.message))
                | Error [] -> assert false);
                let projection_env =
                  Env.bind "__module_input" declaration linked_scope
                in
                let payload =
                  Eval_meta.with_lookup_declaration
                    (fun name -> Env.lookup name !env)
                    (fun () ->
                      fst
                        (evaluate projection_env
                           [
                             Ast.List
                               ( Ast.expr_span expression,
                                 [
                                   Ast.Symbol
                                     ( Ast.expr_span expression,
                                       "form/"
                                       ^ Option.get (head expression)
                                       ^ "/construct" );
                                   Ast.Symbol
                                     (Ast.expr_span expression, "__module_input");
                                 ] );
                           ]))
                in
                match binding with
                | None -> payload
                | Some b ->
                    Value.VMap
                      [
                        ( Value.VKeyword ":identity",
                          Value.VMap
                            [
                              ( Value.VKeyword ":moduleId",
                                Value.VString b.identity.module_id );
                              ( Value.VKeyword ":declaration",
                                Value.VString b.identity.declaration );
                            ] );
                        ( Value.VKeyword ":classification",
                          Value.VSymbol
                            (Option.get b.declaration).classification );
                        (Value.VKeyword ":data", payload);
                      ])
            | _, Some (Ast.List (_, _ :: _ :: value :: _)) -> run value
            | _ -> (
                match Env.lookup n !env with
                | Some value -> value
                | None -> raise Not_found)
          in
          env := Env.bind n value !env;
          Hashtbl.replace ready n ();
          (match (binding, expression) with
          | Some b, Some e when b.identity.module_id = m.id ->
              let inputs =
                collect e
                |> List.filter (fun key -> key <> n)
                |> List.concat_map (fun key ->
                       Option.value ~default:[] (Hashtbl.find_opt origins key))
              in
              let inputs =
                match
                  List.assoc_opt
                    (Option.value ~default:"" (head e))
                    (state.forms ())
                with
                | None -> inputs
                | Some form ->
                    let _, _, _, body = form_parts form.definition in
                    inputs
                    @ (collect body
                      |> List.concat_map (fun name ->
                             Option.value ~default:[]
                               (Hashtbl.find_opt form.owner.origins name)))
              in
              Hashtbl.replace origins n
                (member_origins value (origin b.identity e :: inputs))
          | _ -> ());
          value)
  in
  List.iter (fun (n, _) -> ignore (read n)) applications;
  {
    m with
    compile_time = Some state;
    interface =
      {
        m.interface with
        exports =
          List.map
            (Module_compile_time_interface.enrich m state)
            m.interface.exports;
      };
  }

let expand state expressions =
  List.concat_map
    (fun expression ->
      if
        List.mem
          (Option.value ~default:"" (head expression))
          [ "type"; "form"; "class"; "error"; "service"; "layer"; ":"; "macro" ]
      then [ expression ]
      else
        match
          Eval.expand_program_with_env (state.environment ()) [ expression ]
        with
        | Ok (expanded, _) -> expanded
        | Error (d :: _) ->
            raise
              (Error (Type_diagnostic.make ?span:d.Eval.span d.code d.message))
        | Error [] -> assert false)
    expressions
