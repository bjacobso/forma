let with_graph ~with_session (request : Abi_request.t) k =
  with_session request.session_id (fun session ->
      let default_id =
        if request.source = None && Hashtbl.length session.Session.sources = 1
        then Hashtbl.fold (fun id _ _ -> id) session.sources "request.forma"
        else "request.forma"
      in
      let source_id = Option.value ~default:default_id request.source_id in
      match
        Session_module.graph ?projects:request.projects session ~source_id
          ~source:request.source
      with
      | Error diagnostics -> Abi_response.typecheck_diagnostics_json diagnostics
      | Ok graph -> k session graph)

let interfaces ?checked (graph : Module_graph.t) =
  Ir_json.Array
    (List.map
       (fun (m : Module_graph.resolved_module) ->
         let raw = Module_graph.interface_json m.interface in
         let enriched =
           List.map
             (fun b ->
               let fields =
                 match
                   Module_graph.interface_json
                     { module_id = m.id; exports = [ b ] }
                 with
                 | Ir_json.Object xs -> (
                     match List.assoc "exports" xs with
                     | Ir_json.Array [ Ir_json.Object fields ] -> fields
                     | _ -> [])
                 | _ -> []
               in
               let scheme =
                 Option.bind checked (fun checked ->
                     Option.bind
                       (List.assoc_opt b.Module_graph.identity.module_id
                          checked.Module_runtime.environments)
                       (Type_env.lookup_scheme b.symbol))
               in
               let owner =
                 List.find
                   (fun (owner : Module_graph.resolved_module) ->
                     owner.id = b.identity.module_id)
                   graph.modules
               in
               let expression =
                 List.find_opt
                   (function
                     | Ast.List (_, _ :: Ast.Symbol (_, n) :: _) -> n = b.symbol
                     | Ast.List
                         (_, _ :: Ast.List (_, Ast.Symbol (_, n) :: _) :: _) ->
                         n = b.symbol
                     | _ -> false)
                   owner.expressions
               in
               let fields =
                 match expression with
                 | Some (Ast.List (s, _ :: header :: args))
                   when List.mem b.kind [ "type"; "class"; "error"; "service" ]
                   ->
                     let variables =
                       match header with
                       | Ast.List (_, _ :: params) ->
                           List.filter_map Module_graph.name params
                       | _ -> []
                     in
                     let rec renamed = function
                       | Ast.Symbol (s, n) when List.mem n variables ->
                           let rec index i = function
                             | x :: _ when x = n -> i
                             | _ :: xs -> index (i + 1) xs
                             | [] -> 0
                           in
                           Ast.Symbol
                             (s, "a" ^ string_of_int (index 0 variables))
                       | Ast.List (s, xs) -> Ast.List (s, List.map renamed xs)
                       | Ast.Vector (s, xs) ->
                           Ast.Vector (s, List.map renamed xs)
                       | Ast.Map (s, pairs) ->
                           Ast.Map
                             (s, List.map (fun (k, v) -> (k, renamed v)) pairs)
                       | e -> e
                     in
                     let body =
                       if b.kind = "service" then Ast.List (s, args)
                       else
                         match args with body :: _ -> body | [] -> Ast.Nil s
                     in
                     fields
                     @ [
                         ( "scheme",
                           Ir_json.Object
                             [
                               ( "parameters",
                                 Ir_json.Array
                                   (List.mapi
                                      (fun i _ ->
                                        Ir_json.String ("a" ^ string_of_int i))
                                      variables) );
                               ( "type",
                                 Module_signatures.syntax_json (renamed body) );
                             ] );
                       ]
                 | _ when List.mem b.kind [ "declaration"; "form"; "macro" ] ->
                     fields
                 | _ -> (
                     match (scheme, expression) with
                     | Some (Type_env.Forall (vars, _, _, _) as scheme), Some e
                       -> (
                         try
                           fields
                           @ [
                               ( "scheme",
                                 Ir_json.Object
                                   [
                                     ( "parameters",
                                       Ir_json.Array
                                         (List.mapi
                                            (fun i _ ->
                                              Ir_json.String
                                                ("a" ^ string_of_int i))
                                            vars) );
                                     ( "type",
                                       Module_signatures.syntax_json
                                         (Module_signatures.scheme_syntax
                                            ~target:false e scheme) );
                                   ] );
                             ]
                         with Module_graph.Error _ -> fields)
                     | _ -> fields)
               in
               let fields =
                 match
                   (List.assoc_opt "data" fields, List.assoc_opt "scheme" fields)
                 with
                 | Some (Ir_json.Object data), Some scheme ->
                     List.map
                       (fun (k, v) ->
                         ( k,
                           if k = "data" then
                             Ir_json.Object (data @ [ ("scheme", scheme) ])
                           else v ))
                       fields
                 | _ -> fields
               in
               let fields =
                 match List.assoc_opt "scheme" fields with
                 | Some scheme
                   when Module_contract.contains (Ir_json.to_string scheme)
                          "Declaration" ->
                     List.remove_assoc "scheme" fields
                 | _ -> fields
               in
               Ir_json.Object fields)
             m.interface.exports
         in
         match raw with
         | Ir_json.Object fields ->
             Ir_json.Object
               (List.map
                  (fun (k, v) ->
                    (k, if k = "exports" then Ir_json.Array enriched else v))
                  fields)
         | _ -> raw)
       graph.Module_graph.modules)

let graph ~with_session request =
  with_graph ~with_session request (fun session graph ->
      match Session_module.check session graph with
      | Error diagnostics -> Abi_response.typecheck_diagnostics_json diagnostics
      | Ok checked ->
          Printf.sprintf
            "{\"ok\":true,\"value\":{\"entry\":%s,\"interfaces\":%s}}"
            (Value.string_json graph.entry)
            (Ir_json.to_string (interfaces ~checked graph)))

let evaluate ~with_session request =
  with_graph ~with_session request (fun session graph ->
      match Session_module.initialize session graph with
      | Error diagnostics -> Abi_response.typecheck_diagnostics_json diagnostics
      | Ok (_, instance) ->
          let rec value_json = function
            | Eval.VClosure _ as value ->
                let reference = Session.fresh_value_ref_id session in
                Session.remember_value_ref session reference value;
                Printf.sprintf "{\"kind\":\"function\",\"valueRef\":%s}"
                  (Value.string_json reference)
            | Eval.VList xs ->
                "{\"kind\":\"list\",\"items\":["
                ^ String.concat "," (List.map value_json xs)
                ^ "]}"
            | Eval.VVector xs ->
                "{\"kind\":\"vector\",\"items\":["
                ^ String.concat "," (List.map value_json xs)
                ^ "]}"
            | value -> Eval.value_to_json value
          in
          Printf.sprintf "{\"ok\":true,\"value\":%s}"
            (value_json instance.value))

let typecheck ~with_session request =
  with_graph ~with_session request (fun session graph ->
      match
        Module_runtime.check
          ~prepare:(Abi_type_policy.apply request)
          ~core_env:(Session_module.graph_core_env session graph)
          ~core_types:(Session_module.graph_core_types session graph)
          graph
      with
      | Error diagnostics -> Abi_response.typecheck_diagnostics_json diagnostics
      | Ok checked ->
          let typ =
            Option.value ~default:"Unit"
              (List.assoc_opt graph.entry checked.results)
          in
          Printf.sprintf "{\"ok\":true,\"type\":%s}" (Value.string_json typ))

let declarations ~with_session request =
  with_graph ~with_session request (fun session graph ->
      match Session_module.check session graph with
      | Error diagnostics -> Abi_response.typecheck_diagnostics_json diagnostics
      | Ok checked ->
          let context =
            List.concat_map
              (fun (m : Module_graph.resolved_module) ->
                let expanded =
                  if
                    not
                      (List.exists
                         (fun e -> Surface.head e = Some "macro")
                         m.expressions)
                  then m
                  else
                    match
                      Eval.expand_program_with_env session.core_env
                        m.expressions
                    with
                    | Ok (expressions, _) ->
                        let expanded =
                          List.filter
                            (fun e -> Surface.head e = Some "define")
                            expressions
                        in
                        let expressions =
                          List.filter_map
                            (fun e ->
                              if Surface.head e = Some "macro" then None
                              else
                                match e with
                                | Ast.List
                                    ( _,
                                      Ast.Symbol (_, "define")
                                      :: Ast.Symbol (_, n)
                                      :: _ ) ->
                                    Some
                                      (Option.value ~default:e
                                         (List.find_opt
                                            (function
                                              | Ast.List
                                                  ( _,
                                                    Ast.Symbol (_, "define")
                                                    :: Ast.Symbol (_, name)
                                                    :: _ ) ->
                                                  n = name
                                              | _ -> false)
                                            expanded))
                                | _ -> Some e)
                            m.expressions
                        in
                        { m with expressions }
                    | Error ds -> (
                        match ds with
                        | d :: _ ->
                            raise
                              (Module_graph.Error
                                 (Type_diagnostic.make ?span:d.Eval.span d.code
                                    d.message))
                        | [] -> m)
                in
                Module_signatures.add expanded
                  (Option.value ~default:[]
                     (List.assoc_opt m.id checked.environments)))
              graph.modules
            |> Surface_action.program
            |> Surface.effect_program ~linked:true
          in
          let rec project acc = function
            | [] ->
                let json =
                  List.map
                    (fun d ->
                      let summary = Packageable_declaration.summary d in
                      Ir_json.Object
                        [
                          ( "summary",
                            Ir_json.Object
                              [
                                ( "kind",
                                  Ir_json.String
                                    (Artifact_summary_types
                                     .declaration_summary_kind summary) );
                                ( "name",
                                  match
                                    Artifact_summary_types
                                    .declaration_summary_name summary
                                  with
                                  | Some n -> Ir_json.String n
                                  | None -> Ir_json.Null );
                                ( "resultType",
                                  Ir_json.String
                                    (Artifact_summary_types
                                     .declaration_summary_result_type summary)
                                );
                              ] );
                          ("payload", Artifact_json.declaration_payload_json d);
                          ( "sourceId",
                            Ir_json.String (Packageable_declaration.source_id d)
                          );
                          ( "formIndex",
                            Ir_json.Int (Packageable_declaration.form_index d)
                          );
                        ])
                    acc
                in
                Printf.sprintf
                  "{\"ok\":true,\"value\":{\"entry\":%s,\"interfaces\":%s,\"declarations\":%s}}"
                  (Value.string_json graph.entry)
                  (Ir_json.to_string (interfaces ~checked graph))
                  (Ir_json.to_string (Ir_json.Array json))
            | (m : Module_graph.resolved_module) :: ms -> (
                let owned =
                  List.filter
                    (fun e -> (Ast.expr_span e).source_id = m.id)
                    context
                in
                match
                  Mechanics_artifact.declarations ~context ~module_mode:true
                    ~source_id:m.id owned
                with
                | Error ds -> Abi_response.eval_diagnostics_json ds
                | Ok ds -> project (acc @ ds) ms)
          in
          project [] graph.modules)
