type request = Abi_request.t

module Response = Abi_response

let request_source_id (request : request) =
  match request.source_id with Some source_id -> source_id | None -> "request"

let missing_source operation =
  Response.error_json
    [
      Response.diagnostic_json ~code:"abi/missing-source"
        ~message:(Printf.sprintf "%s requires a source string field." operation);
    ]

let unknown_source source_id =
  Response.error_json
    [
      Response.diagnostic_json ~code:"abi/unknown-source"
        ~message:(Printf.sprintf "Unknown loaded source %S." source_id);
    ]

let parse_ast_text (request : request) source k =
  let source_id = request_source_id request in
  match Reader.parse_ast ~source_id source with
  | Error diagnostics -> Response.reader_diagnostics_json diagnostics
  | Ok exprs -> k exprs

let warning_json span message =
  Printf.sprintf
    "{\"span\":{\"sourceId\":%s,\"startOffset\":%d,\"endOffset\":%d},\"severity\":\"warning\",\"message\":%s,\"notes\":[],\"fixes\":[]}"
    (Value.string_json span.Ast.source_id)
    span.start_offset span.end_offset
    (Value.string_json message)

let pattern_head_name = function
  | Ast.Symbol (_, name) | Ast.Keyword (_, name) -> Some name
  | Ast.List (_, (Ast.Symbol (_, name) | Ast.Keyword (_, name)) :: _)
  | Ast.Vector (_, (Ast.Symbol (_, name) | Ast.Keyword (_, name)) :: _) ->
      Some name
  | _ -> None

let unqualified name = List.hd (List.rev (String.split_on_char '.' name))
let catchall_pattern = function
  | Ast.Symbol (_,n) -> n="_" || (Surface.is_lower n && n<>"nil" && n<>"true" && n<>"false")
  | _ -> false
let total_constructor_pattern pattern =
  let bound = ref [] in
  let rec total = function
    | Ast.Symbol (_,"_") -> true
    | Ast.Symbol (_,n) when Surface.is_lower n && n<>"nil" && n<>"true" && n<>"false" ->
        if List.mem n !bound then false else (bound := n :: !bound; true)
    | Ast.Map (_,fields) -> List.for_all (function Ast.Keyword (_,":keys"),Ast.Vector (_,keys) -> List.for_all total keys | _,v -> total v) fields
    | _ -> false in
  match pattern with
  | Ast.Symbol (_,n) when Surface.is_upper n -> true
  | Ast.List (_,Ast.Symbol (_,n) :: payload) when Surface.is_upper n -> List.for_all total payload
  | _ -> false
let match_pattern_name pattern =
  if total_constructor_pattern pattern then Option.map unqualified (pattern_head_name pattern) else None

let adt_constructor_names = function
  | Ast.List
      ( _,
        Ast.Symbol (_, "__sum-type")
        :: Ast.List (_, Ast.Symbol (_, _) :: _)
        :: constructors ) ->
      constructors |> List.filter (fun e -> Surface.head e <> Some ":tag") |> List.filter_map pattern_head_name
  | _ -> []

let direct_scrutinee_constructor = function
  | Ast.Symbol (_, name) | Ast.Keyword (_, name) -> Some name
  | Ast.List (_, Ast.Symbol (_, name) :: _)
  | Ast.List (_, Ast.Keyword (_, name) :: _)
  | Ast.Vector (_, Ast.Symbol (_, name) :: _)
  | Ast.Vector (_, Ast.Keyword (_, name) :: _) ->
      Some name
  | _ -> None

let constructor_binding env name = List.assoc_opt name env

let rec pattern_bound_names = function
  | Ast.Symbol (_, "_") | Ast.Keyword (_, "_") -> []
  | Ast.Symbol (_, name) | Ast.Keyword (_, name) -> [ name ]
  | Ast.List (_, exprs) | Ast.Vector (_, exprs) ->
      exprs |> List.concat_map pattern_bound_names
  | Ast.Map (_, entries) ->
      entries
      |> List.concat_map (fun (key, value) ->
          pattern_bound_names key @ pattern_bound_names value)
  | Ast.Nil _ | Ast.Bool _ | Ast.Int _ | Ast.Float _ | Ast.String _ -> []

let remove_bound_names env names =
  List.filter (fun (name, _) -> not (List.mem name names)) env

let constructor_binding_of_expr env expr =
  match expr with
  | Ast.Symbol (_, name) -> (
      match constructor_binding env name with
      | Some constructor_name -> Some constructor_name
      | None -> Some name)
  | _ -> direct_scrutinee_constructor expr

let collect_match_warning_jsons exprs =
  let exprs = Surface.core_program exprs in
  let constructor_sets =
    let standard = ["Some",["Some";"None"];"None",["Some";"None"];"Ok",["Ok";"Err"];"Err",["Ok";"Err"]] in
    standard @ (exprs |> List.concat_map (fun expr ->
      let names = adt_constructor_names expr in
      List.map (fun name -> name,names) names)) in
  let constructor_set_for name = List.assoc_opt (unqualified name) constructor_sets in
  let rec analyze_match env span scrutinee arms =
    match Option.bind (constructor_binding_of_expr env scrutinee) constructor_set_for with
    | None -> []
    | Some constructors ->
      let rec scan covered = function
        | [] ->
            let missing = List.filter (fun n -> not (List.mem n covered)) constructors in
            if missing=[] then [] else [warning_json span ("Non-exhaustive match: missing constructor(s) " ^ String.concat ", " missing)]
        | pattern :: _body :: rest when catchall_pattern pattern ->
            if rest=[] then [] else [warning_json span "Unreachable match arm(s) after wildcard pattern"]
        | pattern :: _body :: rest -> (match match_pattern_name pattern with
            | Some n when List.mem n covered -> [warning_json span (Printf.sprintf "Duplicate match arm for constructor '%s'" n)]
            | Some n -> scan (n :: covered) rest
            | None -> scan covered rest)
        | _ -> [] in
      scan [] arms
  and collect_match_arms env arms =
    let rec loop acc = function
      | pattern :: body :: rest ->
          let env = remove_bound_names env (pattern_bound_names pattern) in
          loop (acc @ collect_expr env body) rest
      | _ -> acc
    in
    loop [] arms
  and collect_let env bindings body =
    let rec loop warnings env = function
      | Ast.Symbol (_, name) :: value_expr :: rest ->
          let warnings = warnings @ collect_expr env value_expr in
          let env =
            match constructor_binding_of_expr env value_expr with
            | Some constructor_name ->
                (name, constructor_name) :: remove_bound_names env [ name ]
            | None -> remove_bound_names env [ name ]
          in
          loop warnings env rest
      | _ -> (warnings, env)
    in
    let binding_warnings, env = loop [] env bindings in
    binding_warnings @ List.concat_map (collect_expr env) body
  and collect_lambda env params body =
    let param_names =
      let rec loop acc = function
        | [] -> List.rev acc
        | Ast.Symbol (_, "&") :: Ast.Symbol (_, name) :: rest ->
            loop (name :: acc) rest
        | Ast.Symbol (_, name) :: rest -> loop (name :: acc) rest
        | _ :: rest -> loop acc rest
      in
      loop [] params
    in
    collect_exprs (remove_bound_names env param_names) body
  and collect_expr env = function
    | Ast.List (span, Ast.Symbol (_, "match") :: scrutinee :: arms) ->
        analyze_match env span scrutinee arms
        @ collect_expr env scrutinee
        @ collect_match_arms env arms
    | Ast.List
        (_, Ast.Symbol (_, ("let" | "let*")) :: Ast.Vector (_, bindings) :: body)
      ->
        collect_let env bindings body
    | Ast.List
        (_, Ast.Symbol (_, ("fn" | "lambda")) :: Ast.Vector (_, params) :: body)
      ->
        collect_lambda env params body
    | Ast.List
        ( _,
          [ Ast.Symbol (_, ("define" | "def")); Ast.Symbol (_, _); value_expr ]
        ) ->
        collect_expr env value_expr
    | Ast.List (_, items) | Ast.Vector (_, items) -> collect_exprs env items
    | Ast.Map (_, entries) ->
        entries
        |> List.concat_map (fun (key, value) ->
            collect_expr env key @ collect_expr env value)
    | Ast.Nil _ | Ast.Bool _ | Ast.Int _ | Ast.Float _ | Ast.String _
    | Ast.Symbol _ | Ast.Keyword _ ->
        []
  and collect_exprs _env exprs =
    let rec loop acc env = function
      | [] -> acc
      | Ast.List
          ( _,
            [
              Ast.Symbol (_, ("define" | "def"));
              Ast.Symbol (_, name);
              value_expr;
            ] )
        :: rest ->
          let warnings = acc @ collect_expr env value_expr in
          let env =
            match constructor_binding_of_expr env value_expr with
            | Some constructor_name ->
                (name, constructor_name) :: remove_bound_names env [ name ]
            | None -> remove_bound_names env [ name ]
          in
          loop warnings env rest
      | expr :: rest -> loop (acc @ collect_expr env expr) env rest
    in
    loop [] _env exprs
  in
  collect_exprs [] exprs

let with_request_exprs ~with_session ~missing_source_message (request : request)
    k =
  match (request.source, request.session_id, request.source_id) with
  | Some source, Some session_id, _ ->
      parse_ast_text request source (fun exprs ->
          with_session (Some session_id) (fun session -> k (Some session) exprs))
  | Some source, None, _ ->
      parse_ast_text request source (fun exprs -> k None exprs)
  | None, Some session_id, Some source_id ->
      with_session (Some session_id) (fun session ->
          match Hashtbl.find_opt session.Session.parsed_sources source_id with
          | Some exprs -> k (Some session) exprs
          | None -> unknown_source source_id)
  | None, _, _ ->
      Response.error_json
        [
          Response.diagnostic_json ~code:"abi/missing-source"
            ~message:missing_source_message;
        ]

let with_session_exprs ~with_session ~missing_session_message
    ~missing_source_message (request : request) k =
  match (request.source, request.session_id, request.source_id) with
  | Some source, Some session_id, _ ->
      parse_ast_text request source (fun exprs ->
          with_session (Some session_id) (fun session -> k session exprs))
  | None, Some session_id, Some source_id ->
      with_session (Some session_id) (fun session ->
          match Hashtbl.find_opt session.Session.parsed_sources source_id with
          | Some exprs -> k session exprs
          | None -> unknown_source source_id)
  | Some _, None, _ | None, None, _ ->
      Response.error_json
        [
          Response.diagnostic_json ~code:"abi/missing-session"
            ~message:missing_session_message;
        ]
  | None, Some _, None ->
      Response.error_json
        [
          Response.diagnostic_json ~code:"abi/missing-source"
            ~message:missing_source_message;
        ]

let parse_source (request : request) =
  match request.source with
  | None -> missing_source "parse"
  | Some source -> (
      let source_id = request_source_id request in
      match Reader.parse_cst ~source_id source with
      | Error diagnostics -> Response.reader_diagnostics_json diagnostics
      | Ok exprs ->
          Printf.sprintf "{\"ok\":true,\"value\":[%s]}"
            (String.concat "," (List.map Reader.expr_to_json exprs)))

let parse_ast_source (request : request) =
  match request.source with
  | None -> missing_source "parseAst"
  | Some source ->
      parse_ast_text request source (fun exprs ->
          Printf.sprintf "{\"ok\":true,\"value\":%s}"
            (Response.ast_exprs_json exprs))

let parse_summary (request : request) =
  match request.source with
  | None -> missing_source "parseSummary"
  | Some source -> (
      let source_id = request_source_id request in
      match Reader.parse_cst ~source_id source with
      | Error diagnostics -> Response.reader_diagnostics_json diagnostics
      | Ok exprs ->
          Printf.sprintf "{\"ok\":true,\"value\":{\"formCount\":%d}}"
            (List.length exprs))

let expand_exprs env exprs =
  match env with
  | None -> Eval.expand_program exprs
  | Some env -> Eval.expand_program_with_env env exprs |> Result.map fst

let expand_source ~with_session (request : request) =
  let expand_and_encode env exprs =
    match expand_exprs env exprs with
    | Error diagnostics -> Response.eval_diagnostics_json diagnostics
    | Ok exprs ->
        Printf.sprintf "{\"ok\":true,\"value\":%s}"
          (Response.ast_exprs_json exprs)
  in
  with_request_exprs ~with_session
    ~missing_source_message:
      "expand requires either a source string field or sessionId plus sourceId."
    request (fun session exprs ->
      let exprs =
        Session_module.expressions session
          ~source_id:(request_source_id request) ~source:request.source exprs
      in
      expand_and_encode
        (Option.map (fun session -> session.Session.core_env) session)
        exprs)

let lower_core_source ~with_session (request : request) =
  let lower_exprs env exprs =
    match expand_exprs env exprs with
    | Error diagnostics -> Response.eval_diagnostics_json diagnostics
    | Ok expanded -> (
        match Lower.program expanded with
        | Error diagnostics -> Response.lower_diagnostics_json diagnostics
        | Ok program ->
            Printf.sprintf "{\"ok\":true,\"value\":%s}"
              (Core_ast.program_to_json program))
  in
  with_request_exprs ~with_session
    ~missing_source_message:
      "lowerCore requires either a source string field or sessionId plus \
       sourceId." request (fun session exprs ->
      let exprs =
        Session_module.expressions session
          ~source_id:(request_source_id request) ~source:request.source exprs
      in
      lower_exprs
        (Option.map (fun session -> session.Session.core_env) session)
        exprs)

let typecheck_typed_core ?(syntax=[]) type_env eval_env program =
  match (type_env, eval_env) with
  | None, None ->
      Typecheck.typecheck_core_program_typed_with_descriptor_infer
        Descriptor_protocol.empty_hooks [] program
      |> Result.map fst
  | Some type_env, None ->
      Typecheck.typecheck_core_program_typed_with_descriptor_infer
        Descriptor_protocol.empty_hooks type_env program
      |> Result.map fst
  | None, Some env ->
      Typecheck.typecheck_core_program_typed_with_descriptor_infer
        (Descriptor_contract.descriptor_hooks ~syntax env)
        [] program
      |> Result.map fst
  | Some type_env, Some env ->
      Typecheck.typecheck_core_program_typed_with_descriptor_infer
        (Descriptor_contract.descriptor_hooks ~syntax env)
        type_env program
      |> Result.map fst

let typecheck_core_success_json ?(typed_core = false) program =
  let result_type = Typed_core.result_type_string program in
  if typed_core then
    Printf.sprintf "{\"ok\":true,\"type\":\"%s\",\"typedCore\":%s}"
      (Response.json_escape result_type)
      (Typed_core.to_json program)
  else
    Printf.sprintf "{\"ok\":true,\"type\":\"%s\"}"
      (Response.json_escape result_type)

let typecheck_core_result_json ?(syntax=[]) ~typed type_env eval_env program =
  match typecheck_typed_core ~syntax type_env eval_env program with
  | Error diagnostics -> Response.typecheck_diagnostics_json diagnostics
  | Ok program -> typecheck_core_success_json ~typed_core:typed program

let typecheck_core_source ?(typed = false) ~with_session (request : request) =
  let typecheck_exprs type_env eval_env exprs =
    match expand_exprs eval_env exprs with
    | Error diagnostics -> Response.eval_diagnostics_json diagnostics
    | Ok expanded -> (
        match Lower.program expanded with
        | Error diagnostics -> Response.lower_diagnostics_json diagnostics
        | Ok program ->
            typecheck_core_result_json ~syntax:expanded ~typed type_env eval_env program)
  in
  with_request_exprs ~with_session
    ~missing_source_message:
      "typecheckCore requires either a source string field or sessionId plus \
       sourceId." request (fun session exprs ->
      match session with
      | None -> typecheck_exprs None None exprs
      | Some session -> (
          match
            Session_module.graph session
              ~source_id:(request_source_id request)
              ~source:request.source
          with
          | Error diagnostics -> Response.typecheck_diagnostics_json diagnostics
          | Ok graph -> (
              let dependencies =
                {
                  graph with
                  Module_graph.modules =
                    List.filter
                      (fun (m : Module_graph.resolved_module) ->
                        m.id <> graph.entry)
                      graph.modules;
                }
              in
              match Session_module.check session dependencies with
              | Error diagnostics ->
                  Response.typecheck_diagnostics_json diagnostics
              | Ok checked ->
                  let root =
                    List.find
                      (fun (m : Module_graph.resolved_module) ->
                        m.id = graph.entry)
                      graph.modules
                  in
                  let types =
                    Module_runtime.imported_types root checked.environments
                    @ session.Session.core_types
                  in
                  (* Descriptor applications carry declaration data. Build only
                     this file's data context; no sibling source scope is visible. *)
                  let local =
                    Artifact_context.environment session
                      ~sources:[ (root.id, root.expressions) ]
                      ()
                  in
                  let types =
                    List.fold_left
                      (fun types (name, value) ->
                        match Descriptor.declaration_form value with
                        | Some _ -> (
                            let scheme =
                              Type_env.Forall
                                ([], Type_expr.TDeclaration, [], Type_env.Plain)
                            in
                            let types = Type_env.bind name scheme types in
                            match List.assoc_opt name root.bindings with
                            | Some binding ->
                                Type_env.bind binding.symbol scheme types
                            | None -> types)
                        | None -> types)
                      types
                      (Env.visible_bindings local)
                  in
                  let expressions =
                    List.filter
                      (function
                        | Ast.List
                            ( _,
                              [
                                Ast.Symbol (_, "define");
                                Ast.Symbol (_, symbol);
                                Ast.Symbol (_, raw);
                              ] ) ->
                            not
                              (List.exists
                                 (fun (_, b) ->
                                   b.Module_graph.symbol = symbol
                                   && b.name = raw)
                                 root.bindings)
                        | _ -> true)
                      root.expressions
                  in
                  typecheck_exprs (Some types) (Some local) expressions)))

let evaluate_source ~with_session (request : request) =
  let evaluate_exprs env exprs =
    let evaluated =
      match env with
      | None -> Eval.evaluate_program exprs
      | Some env -> Eval.evaluate_program_with_env env exprs |> Result.map fst
    in
    match evaluated with
    | Error diagnostics -> Response.eval_diagnostics_json diagnostics
    | Ok value ->
        Printf.sprintf "{\"ok\":true,\"value\":%s}" (Eval.value_to_json value)
  in
  with_request_exprs ~with_session
    ~missing_source_message:
      "evaluate requires either a source string field or sessionId plus \
       sourceId." request (fun session exprs ->
      evaluate_exprs
        (Option.map (fun session -> session.Session.env) session)
        exprs)

let typecheck_source ~with_session (request : request) =
  let typecheck_exprs type_env eval_env exprs =
    match expand_exprs eval_env exprs with
    | Error diagnostics -> Response.eval_diagnostics_json diagnostics
    | Ok expanded -> (
        let base_env = Option.value type_env ~default:[] in
        match Abi_type_policy.apply request base_env expanded with
        | Error diagnostics -> Response.typecheck_diagnostics_json diagnostics
        | Ok type_env ->
            let extra_diagnostics = collect_match_warning_jsons expanded in
            let result = match Descriptor_contract.validate_unified_forms (Option.value ~default:Env.empty eval_env) expanded with
              | Error _ as e -> e
              | Ok () -> match request.result with
              | Some "per-expression" ->
                  Typecheck.typecheck_program_with_env_all type_env expanded
                  |> Result.map (fun (expression_types, typ, _env) ->
                      (typ, expression_types))
              | _ ->
                  Typecheck.typecheck_program_with_env type_env expanded
                  |> Result.map (fun (typ, _env) -> (typ, []))
            in
            match result with
            | Error diagnostics ->
                Response.typecheck_diagnostics_json diagnostics
            | Ok (typ, expression_types) ->
                Abi_typecheck_response.success_json request typ expanded
                  extra_diagnostics ~expression_types)
  in
  match (request.source, request.session_id, request.source_id) with
  | Some source, Some session_id, _ ->
      parse_ast_text request source (fun exprs ->
          with_session (Some session_id) (fun session ->
              typecheck_exprs (Some session.Session.type_env)
                (Some session.Session.env) exprs))
  | Some source, None, _ ->
      parse_ast_text request source (fun exprs ->
          typecheck_exprs None None exprs)
  | None, Some session_id, Some source_id ->
      with_session (Some session_id) (fun session ->
          match Hashtbl.find_opt session.Session.parsed_sources source_id with
          | Some exprs ->
              typecheck_exprs (Some session.Session.type_env)
                (Some session.Session.env) exprs
          | None -> unknown_source source_id)
  | None, _, _ ->
      Response.error_json
        [
          Response.diagnostic_json ~code:"abi/missing-source"
            ~message:
              "typecheck requires either a source string field or sessionId \
               plus sourceId.";
        ]

let emitted_values_exprs (session : Session.t) exprs =
  match Elaborate.emitted_values (Artifact_context.environment session ()) (Artifact_context.expressions exprs) with
  | Error diagnostics -> Response.eval_diagnostics_json diagnostics
  | Ok values ->
      Printf.sprintf "{\"ok\":true,\"value\":%s,\"diagnostics\":%s}"
        (Elaborate.emitted_values_json values) (Response.diagnostic_array (Elaborate.emitted_values_diagnostics values))

let emitted_values_source ~with_session (request : request) =
  with_session_exprs ~with_session
    ~missing_session_message:
      "elaborate requires a sessionId so loaded preludes can provide construct \
       hooks."
    ~missing_source_message:
      "elaborate requires either a source string field or sessionId plus \
       sourceId."
    request emitted_values_exprs
