open Type_expr

type checked = {
  environments : (string * Type_env.env) list;
  results : (string * string) list;
}

type instance = {
  source : string;
  dependencies : instance list;
  env : Eval.env;
  value : Eval.value;
}

(** Source-local type names in descriptor data are author identifiers. They are
    available to form validation, never to the executable lexical environment.
*)
let local_type_metadata core_env (m : Module_graph.resolved_module) =
  match Reader.parse_ast ~source_id:m.id m.source with
  | Error _ -> core_env
  | Ok syntax -> (
      let metadata =
        Surface.core_program
          (List.filter (fun e -> not (Module_graph.directive e)) syntax)
        |> List.concat_map (fun e ->
            Option.value ~default:[] (Surface.runtime_constructors e))
        |> List.filter (function
          | Ast.List (_, Ast.Symbol (_, "define") :: Ast.Symbol (_, n) :: _) ->
              List.exists
                (fun prefix -> String.starts_with ~prefix n)
                [ "__type/"; "__type-kind/"; "__constructor/" ]
          | _ -> false)
      in
      match Eval.evaluate_program_with_env core_env metadata with
      | Ok (_, env) -> env
      | Error _ -> core_env)

let imported_types (m : Module_graph.resolved_module) environments =
  let imported =
    List.map snd m.imports @ m.namespace_imports
    @ List.filter
        (fun b -> b.Module_graph.identity.module_id <> m.id)
        m.interface.exports
  in
  let allowed =
    List.concat_map
      (fun b ->
        b.Module_graph.symbol :: ("__type/" ^ b.symbol)
        :: ("__record/" ^ b.symbol) :: ("__alias/" ^ b.symbol)
        :: ("__type-kind/" ^ b.symbol)
        :: ("__constructor/" ^ b.symbol)
        :: List.concat_map
             (fun c ->
               [ b.symbol ^ "." ^ c; "__constructor/" ^ b.symbol ^ "." ^ c ])
             b.constructors)
      imported
  in
  m.dependencies
  |> List.concat_map (fun id ->
      Option.value ~default:[] (List.assoc_opt id environments))
  |> List.filter (fun (n, _) -> List.mem n allowed)

let check ?(prepare = fun env _ -> Ok env) ~core_env ~core_types
    (graph : Module_graph.t) =
  let rec loop environments results = function
    | [] ->
        let rec names = function
          | Type_expr.TNamed n -> [ n ]
          | TNamedApp (n, args) -> n :: List.concat_map names args
          | TApp (t, args) -> names t @ List.concat_map names args
          | TFn (params, result) -> List.concat_map names (result :: params)
          | TVariadicFn (params, rest, result) ->
              List.concat_map names (rest :: result :: params)
          | TRecord fields -> List.concat_map (fun (_, t) -> names t) fields
          | TOpenRecord (fields, tail) ->
              names tail @ List.concat_map (fun (_, t) -> names t) fields
          | TList t | TVector t -> names t
          | _ -> []
        in
        let diagnostics =
          List.concat_map
            (fun (m : Module_graph.resolved_module) ->
              let env =
                Option.value ~default:[] (List.assoc_opt m.id environments)
              in
              List.concat_map
                (fun b ->
                  let rec syntax_names = function
                    | Ast.Symbol (_, n) -> [ n ]
                    | Ast.List (_, xs) | Ast.Vector (_, xs) ->
                        List.concat_map syntax_names xs
                    | Ast.Map (_, pairs) ->
                        List.concat_map (fun (_, v) -> syntax_names v) pairs
                    | _ -> []
                  in
                  let references =
                    (match Type_env.lookup_scheme b.Module_graph.symbol env with
                      | Some (Type_env.Forall (_, t, _, _)) -> names t
                      | None -> [])
                    @
                    if List.mem b.kind [ "type"; "class"; "error"; "service" ]
                    then
                      List.concat_map
                        (function
                          | Ast.List (_, _ :: Ast.Symbol (_, n) :: body)
                          | Ast.List
                              ( _,
                                _
                                :: Ast.List (_, Ast.Symbol (_, n) :: _)
                                :: body )
                            when n = b.symbol ->
                              List.concat_map syntax_names body
                          | _ -> [])
                        m.expressions
                    else []
                  in
                  List.concat_map
                    (fun (owner : Module_graph.resolved_module) ->
                      List.filter_map
                        (fun (_, private_type) ->
                          if
                            List.mem private_type.Module_graph.kind
                              [ "type"; "class"; "error"; "service" ]
                            && List.mem private_type.symbol references
                            && not
                                 (List.exists
                                    (fun public ->
                                      public.Module_graph.symbol
                                      = private_type.symbol)
                                    owner.interface.exports)
                          then
                            let span =
                              List.find_opt
                                (function
                                  | Ast.List (_, _ :: Ast.Symbol (_, n) :: _) ->
                                      n = b.symbol
                                  | _ -> false)
                                m.expressions
                              |> Option.map Ast.expr_span
                            in
                            Some
                              (Type_diagnostic.make ?span "module/private-type"
                                 ("Public " ^ b.name ^ " exposes private type "
                                ^ private_type.name ^ " from " ^ owner.id
                                ^ "; export " ^ private_type.name
                                ^ " in its owning module."))
                          else None)
                        owner.bindings)
                    graph.modules)
                m.interface.exports)
            graph.modules
        in
        if diagnostics = [] then Ok { environments; results }
        else Error diagnostics
    | (m : Module_graph.resolved_module) :: ms -> (
        let initial = imported_types m environments @ core_types in
        match Eval.expand_program_with_env core_env m.expressions with
        | Error ds ->
            Error
              (List.map
                 (fun (d : Eval.diagnostic) ->
                   Type_diagnostic.make ?span:d.span d.code d.message)
                 ds)
        | Ok (expanded, _) -> (
            match
              Descriptor_contract.validate_unified_forms
                (local_type_metadata core_env m)
                expanded
            with
            | Error ds -> Error ds
            | Ok () -> (
                match
                  Result.bind (prepare initial expanded) (fun env ->
                      Typecheck.typecheck_program_with_env env expanded)
                with
                | Error ds -> Error ds
                | Ok (typ, env) ->
                    loop
                      ((m.id, env) :: environments)
                      ((m.id, typ) :: results) ms)))
  in
  loop [] [] graph.modules

let definition e =
  List.mem
    (Option.value ~default:"" (Surface.head e))
    [
      "define";
      ":";
      "type";
      "class";
      "error";
      "macro";
      "form";
      "typeclass";
      "instance";
      "entity";
      "query";
      "command";
      "view";
      "rule";
      "protocol";
    ]

let imported_env ~core_env (m : Module_graph.resolved_module) dependencies =
  let imported =
    List.map snd m.imports @ m.namespace_imports
    @ List.filter
        (fun b -> b.Module_graph.identity.module_id <> m.id)
        m.interface.exports
  in
  let allowed =
    List.concat_map
      (fun b ->
        b.Module_graph.symbol :: ("__type/" ^ b.symbol)
        :: ("__record/" ^ b.symbol) :: ("__alias/" ^ b.symbol)
        :: ("__type-kind/" ^ b.symbol)
        :: ("__constructor/" ^ b.symbol)
        :: List.concat_map
             (fun c ->
               [ b.symbol ^ "." ^ c; "__constructor/" ^ b.symbol ^ "." ^ c ])
             b.constructors)
      imported
  in
  let bindings =
    List.concat_map (fun i -> Env.visible_bindings i.env) dependencies
    |> List.filter (fun (n, _) -> List.mem n allowed)
  in
  Env.extend bindings core_env

let initialize ?(entry_expressions = true) ~core_env ~core_types
    (graph : Module_graph.t) instances =
  let _ = core_types in
  let checked = { environments = []; results = [] } in
  let effects =
    List.concat_map
      (fun (m : Module_graph.resolved_module) ->
        List.filter_map
          (fun e ->
            if
              List.mem
                (Option.value ~default:"" (Surface.head e))
                [ "service"; "layer" ]
              ||
              match e with
              | Ast.List
                  ( _,
                    (Ast.Symbol (_, ":") | Ast.Keyword (_, ":")) :: _ :: t :: _
                  ) ->
                  Surface.head t = Some "Effect"
              | _ -> false
            then
              Some
                (Type_diagnostic.make ~span:(Ast.expr_span e)
                   "module/effect-runtime"
                   "Evaluate this Effect program through linkEffectModules and \
                    the Effect runtime; kernel module evaluation supports pure \
                    definitions.")
            else None)
          m.expressions)
      graph.modules
  in
  if effects <> [] then Error effects
  else
    let rec loop = function
      | [] -> (
          let instance = Hashtbl.find instances graph.entry in
          let entry =
            List.find
              (fun (m : Module_graph.resolved_module) -> m.id = graph.entry)
              graph.modules
          in
          let expressions =
            List.filter (fun e -> not (definition e)) entry.expressions
          in
          if (not entry_expressions) || expressions = [] then
            Ok (checked, instance)
          else
            match Eval.evaluate_program_with_env instance.env expressions with
            | Ok (value, env) -> Ok (checked, { instance with value; env })
            | Error ds ->
                Error
                  (List.map
                     (fun (d : Eval.diagnostic) ->
                       Type_diagnostic.make ?span:d.span d.code d.message)
                     ds))
      | (m : Module_graph.resolved_module) :: ms -> (
          let dependency_instances =
            List.map (Hashtbl.find instances) m.dependencies
          in
          match Hashtbl.find_opt instances m.id with
          | Some i
            when i.source = m.source
                 && List.length i.dependencies
                    = List.length dependency_instances
                 && List.for_all2 ( == ) i.dependencies dependency_instances ->
              loop ms
          | _ -> (
              let env = imported_env ~core_env m dependency_instances in
              match
                Eval.evaluate_program_with_env env
                  (List.filter definition m.expressions)
              with
              | Error ds ->
                  Error
                    (List.map
                       (fun (d : Eval.diagnostic) ->
                         Type_diagnostic.make ?span:d.span d.code d.message)
                       ds)
              | Ok (value, env) ->
                  Hashtbl.replace instances m.id
                    {
                      source = m.source;
                      dependencies = dependency_instances;
                      env;
                      value;
                    };
                  loop ms))
    in
    loop graph.modules

let imports ~core_env ~core_types (graph : Module_graph.t) instances =
  let libraries =
    List.filter
      (fun (m : Module_graph.resolved_module) -> m.id <> graph.entry)
      graph.modules
  in
  let initialized =
    match List.rev libraries with
    | [] -> Ok ()
    | m :: _ ->
        initialize ~entry_expressions:false ~core_env ~core_types
          { Module_graph.entry = m.id; modules = libraries }
          instances
        |> Result.map (fun _ -> ())
  in
  Result.map
    (fun () ->
      let entry =
        List.find
          (fun (m : Module_graph.resolved_module) -> m.id = graph.entry)
          graph.modules
      in
      ( imported_env ~core_env entry
          (List.map (Hashtbl.find instances) entry.dependencies),
        entry.expressions ))
    initialized
