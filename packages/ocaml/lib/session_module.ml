let graph (session : Session.t) ~source_id ~source =
  let sources =
    Hashtbl.fold
      (fun id s acc -> Module_graph.{ id; source = Source.text s } :: acc)
      session.sources []
  in
  let id = Module_graph.normalize_id source_id in
  let entry =
    match source with
    | Some source -> Some Module_graph.{ id; source }
    | None -> List.find_opt (fun (s : Module_graph.source) -> s.id = id) sources
  in
  match entry with
  | None ->
      Error
        [
          Type_diagnostic.make "module/not-found"
            ("Unknown loaded module " ^ id ^ ".");
        ]
  | Some entry ->
      let rec type_names = function
        | Type_expr.TNamed n -> [ n ]
        | TNamedApp (n, args) -> n :: List.concat_map type_names args
        | TApp (t, args) -> List.concat_map type_names (t :: args)
        | TFn (args, t) -> List.concat_map type_names (args @ [ t ])
        | TVariadicFn (args, r, t) ->
            List.concat_map type_names (args @ [ r; t ])
        | TRecord fs -> List.concat_map (fun (_, t) -> type_names t) fs
        | TOpenRecord (fs, r) ->
            List.concat_map (fun (_, t) -> type_names t) fs @ type_names r
        | TList t | TVector t -> type_names t
        | _ -> []
      in
      let core_bindings =
        List.map fst (Env.visible_bindings session.core_env)
      in
      let core_type_names =
        List.concat_map
          (fun (_, Type_env.Forall (_, t, _, _)) -> type_names t)
          session.core_types
        @ List.filter_map
            (fun n ->
              if String.starts_with ~prefix:"__type/" n then
                Some (String.sub n 7 (String.length n - 7))
              else None)
            core_bindings
      in
      let data_forms =
        List.filter
          (fun n -> Descriptor.is_form_descriptor session.core_env n)
          core_bindings
      in
      Module_graph.resolve ~data_forms ~core_bindings ~core_type_names
        ~is_core_binding:(fun n ->
          Module_graph.contains n "/"
          && Eval_meta_protocol_assembly.assemble_runtime_contract_for_op
               session.core_env n
             <> None)
        entry
        (Module_graph.source_resolver sources)

let check session graph =
  Module_runtime.check ~core_env:session.Session.core_env
    ~core_types:session.core_types graph

let expressions_in_session session ~source_id ~source fallback =
  match graph session ~source_id ~source with
  | Ok graph ->
      (List.find
         (fun (m : Module_graph.resolved_module) -> m.id = graph.entry)
         graph.modules)
        .expressions
  | Error (diagnostic :: _) -> raise (Module_graph.Error diagnostic)
  | Error [] -> fallback

let expressions session ~source_id ~source fallback =
  match session with
  | None -> fallback
  | Some session -> expressions_in_session session ~source_id ~source fallback

let initialize session graph =
  Module_runtime.initialize ~core_env:session.Session.core_env
    ~core_types:session.core_types graph session.module_instances
