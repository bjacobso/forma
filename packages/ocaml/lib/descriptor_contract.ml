let normalize_name name =
  if String.length name > 0 && name.[0] = ':' then
    String.sub name 1 (String.length name - 1)
  else name

let type_expr_of_meta_type_value = function
  | value -> (
      match Descriptor_meta.type_expr_of_value value with
      | Some _ as typ -> typ
      | None -> (
          match value with
          | Value.VString name | Value.VSymbol name | Value.VKeyword name ->
              Some (Type_expr.TNamed (normalize_name name))
          | _ -> None))

let resolve_result_type env ~form_name ~run_hook =
  match
    Option.bind
      (Descriptor.result_type env form_name)
      type_expr_of_meta_type_value
  with
  | Some _ as typ -> Ok typ
  | None -> run_hook ()

let summary_field field = function
  | Value.VMap entries ->
      List.find_map
        (function
          | (Value.VKeyword key | Value.VString key | Value.VSymbol key), value
            when normalize_name key = field ->
              Some value
          | _ -> None)
        entries
  | _ -> None

let required_summary_text field summary_value =
  match
    Option.bind (summary_field field summary_value) Descriptor.value_text
  with
  | Some value -> Ok value
  | None ->
      Error
        (Printf.sprintf
           "Explicit declaration summary metadata must include a string :%s \
            field."
           field)

let optional_summary_text field summary_value =
  match summary_field field summary_value with
  | None -> Ok None
  | Some value -> (
      match Descriptor.value_text value with
      | Some text -> Ok (Some text)
      | None ->
          Error
            (Printf.sprintf
               "Explicit declaration summary metadata :%s field must be \
                textual when present."
               field))

let parse_explicit_declaration_summary summary_value =
  match
    ( required_summary_text "kind" summary_value,
      optional_summary_text "name" summary_value,
      required_summary_text "resultType" summary_value )
  with
  | Ok kind, Ok name, Ok result_type ->
      Ok
        (Artifact_summary_types.make_declaration_summary ~kind ~name
           ~type_name:result_type)
  | Error message, _, _ | _, Error message, _ | _, _, Error message ->
      Error message

let required_declaration_summary_of_emitted_value value =
  match Descriptor.value_keyword ":$summary" value with
  | None ->
      Error "Declaration payload must include explicit :$summary metadata."
  | Some summary_value -> parse_explicit_declaration_summary summary_value

let positional_items = function
  | Core_ast.App (_, Core_ast.Var (_, _), items) -> Some items
  | _ -> None

let eval_diagnostic_to_type (diagnostic : Eval.diagnostic) =
  Type_diagnostic.make ?span:diagnostic.span diagnostic.code diagnostic.message

let descriptor_type_result ?expected ~span ~code ~description value =
  match Descriptor_meta.type_expr_of_value value with
  | Some ty -> Ok (Some ty)
  | None -> (
      match expected with
      | Some expected
        when Value.equal value Value.VNil
             || Value.equal value (Value.VBool true) ->
          Ok (Some expected)
      | None
        when Value.equal value Value.VNil
             || Value.equal value (Value.VBool true) ->
          Ok None
      | _ -> Error [ Type_diagnostic.make ~span code description ])

let binding_entry_to_scheme span = function
  | Value.VString name, type_value
  | Value.VSymbol name, type_value
  | Value.VKeyword name, type_value -> (
      match Descriptor_meta.type_expr_of_value type_value with
      | Some typ ->
          Ok (normalize_name name, Type_env.Forall ([], typ, [], Type_env.Plain))
      | None ->
          Error
            [
              Type_diagnostic.make ?span "typecheck/descriptor-binding-type"
                (Printf.sprintf
                   "Descriptor bindings must return typed values; received %S \
                    for binding %S."
                   (Value.to_str_part type_value)
                   (normalize_name name));
            ])
  | key, _ ->
      Error
        [
          Type_diagnostic.make ?span "typecheck/descriptor-binding-name"
            (Printf.sprintf
               "Descriptor bindings must use symbolic binding names; received \
                %S."
               (Value.to_str_part key));
        ]

let binding_entries_result ?hook_name ~form_name span = function
  | Value.VNil -> Ok []
  | Value.VMap entries ->
      let rec loop acc = function
        | [] -> Ok (List.rev acc)
        | entry :: rest -> (
            match binding_entry_to_scheme (Some span) entry with
            | Ok binding -> loop (binding :: acc) rest
            | Error _ as error -> error)
      in
      loop [] entries
  | value ->
      let message =
        match hook_name with
        | Some hook_name ->
            Printf.sprintf
              "Descriptor bindings hook %S for form %S must return a binding \
               map; received %S."
              hook_name form_name (Value.to_str_part value)
        | None ->
            Printf.sprintf
              "Descriptor bindings for form %S must return a binding map; \
               received %S."
              form_name (Value.to_str_part value)
      in
      Error
        [ Type_diagnostic.make ~span "typecheck/descriptor-bindings" message ]

let run_bindings_hook env
    (application : Descriptor_protocol.descriptor_application) =
  match Descriptor.bindings_hook env application.form_name with
  | None -> Ok (None, Value.VNil)
  | Some hook_name -> (
      match Descriptor_meta.apply_hook env hook_name "bindings" application with
      | Error diagnostics ->
          Error (List.map eval_diagnostic_to_type diagnostics)
      | Ok value -> Ok (Some hook_name, value))

let hook_bindings env (application : Descriptor_protocol.descriptor_application)
    =
  match run_bindings_hook env application with
  | Error _ as error -> error
  | Ok (hook_name, value) ->
      binding_entries_result ?hook_name ~form_name:application.form_name
        application.span value

let bindings env application = hook_bindings env application

let check_expr span env expected_type expr =
  match Descriptor_meta.type_expr_of_value expected_type with
  | None ->
      Error
        [
          Type_diagnostic.make ~span "typecheck/unknown-type"
            (Printf.sprintf "Unknown slot type %S."
               (Value.to_str_part expected_type));
        ]
  | Some expected -> (
      match Typecheck.infer_core_expr env expr with
      | Error _ as error -> error
      | Ok actual -> (
          match Type_unify.unify_with_span span expected actual with
          | Ok _ -> Ok ()
          | Error _ as error -> error))

let check_child_slot env expr (child_slot : Descriptor.typed_child_slot) =
  match (child_slot.positional_index, positional_items expr) with
  | Some index, Some items -> (
      match List.nth_opt items index with
      | None -> Ok ()
      | Some child -> (
          match child_slot.typ with
          | Some typ -> check_expr (Core_ast.expr_span child) env typ child
          | None -> Ok ()))
  | _ -> Ok ()

let collect_checks checks =
  let diagnostics =
    checks
    |> List.fold_left
         (fun diagnostics check ->
           match check with
           | Ok () -> diagnostics
           | Error next -> List.rev_append next diagnostics)
         []
    |> List.rev
  in
  match diagnostics with [] -> Ok () | _ -> Error diagnostics

let scoped_type_env env
    (application : Descriptor_protocol.descriptor_application) =
  match hook_bindings env application with
  | Ok bindings -> Ok (bindings @ application.type_env)
  | Error _ as error -> error

let run_typed_hook ?expected ~phase ~code ~description hook_lookup env
    (application : Descriptor_protocol.descriptor_application) =
  match scoped_type_env env application with
  | Error _ as error -> error
  | Ok type_env -> (
      let application = { application with type_env } in
      match hook_lookup env application.form_name with
      | None -> Ok None
      | Some hook_name -> (
          match Descriptor_meta.apply_hook env hook_name phase application with
          | Error diagnostics ->
              Error (List.map eval_diagnostic_to_type diagnostics)
          | Ok value ->
              descriptor_type_result ?expected ~span:application.span ~code
                ~description:(description hook_name application value)
                value))

let result_type env (application : Descriptor_protocol.descriptor_application) =
  resolve_result_type env ~form_name:application.form_name ~run_hook:(fun () ->
      run_typed_hook ~phase:"result-type"
        ~code:"typecheck/descriptor-result-type"
        ~description:(fun hook_name application value ->
          Printf.sprintf
            "Descriptor result-type hook %S for form %S must return a known \
             type name or {:type <name>}; received %S."
            hook_name application.form_name (Value.to_str_part value))
        Descriptor.result_type_hook env application)

let run_check_hook env
    (application : Descriptor_protocol.descriptor_application) =
  run_typed_hook ?expected:application.expected ~phase:"check"
    ~code:"typecheck/descriptor-check"
    ~description:(fun hook_name application value ->
      Printf.sprintf
        "Descriptor check hook %S for form %S must return a known type name, \
         {:type <name>}, true, or nil; received %S."
        hook_name application.form_name (Value.to_str_part value))
    Descriptor.check_hook env application

let check_typed_slots env
    (application : Descriptor_protocol.descriptor_application) =
  let typed_slots = Descriptor.typed_slots env application.form_name in
  match scoped_type_env env application with
  | Error _ as error -> error
  | Ok slot_env -> (
      let check_child_slots expr child_slots =
        child_slots
        |> List.map (check_child_slot slot_env expr)
        |> collect_checks
      in
      let check_slot (slot_argument : Descriptor_protocol.slot_argument) =
        match
          List.find_opt
            (fun (slot : Descriptor.typed_slot) ->
              slot.name = slot_argument.slot_name)
            typed_slots
        with
        | None -> Ok ()
        | Some slot -> (
            match slot.typ with
            | Some typ ->
                check_expr slot_argument.span slot_env typ slot_argument.expr
            | None -> check_child_slots slot_argument.expr slot.child_slots)
      in
      let slot_checks =
        application.slot_arguments |> List.map check_slot |> collect_checks
      in
      match slot_checks with
      | Error _ as error -> error
      | Ok () -> run_check_hook env application |> Result.map (fun _ -> ()))

let descriptor_infer_type env application =
  run_typed_hook ~phase:"infer" ~code:"typecheck/descriptor-infer"
    ~description:(fun hook_name application value ->
      Printf.sprintf
        "Descriptor infer hook %S for form %S must return a known type name or \
         {:type <name>}; received %S."
        hook_name application.form_name (Value.to_str_part value))
    Descriptor.infer_hook env application

let descriptor_check_type env application = run_check_hook env application

let load_unified_context env syntax =
  (* Function helpers are closures: loading them does not run their bodies.
     Source-local form hooks can therefore call the same helpers as loaded forms. *)
  let metadata=List.filter (function
    | Ast.List (_,Ast.Symbol (_,"define") :: Ast.Symbol _ :: Ast.List (_,Ast.Symbol (_,"fn") :: _) :: []) -> true
    | Ast.List (_,Ast.Symbol (_, ("__sum-type" | "__record-type" | "__type-alias" | "__form-descriptor" | "__form-hook")) :: _) -> true
    | Ast.List (_,Ast.Symbol (_,"define") :: Ast.Symbol (_,n) :: _) ->
        List.exists (fun prefix -> String.starts_with ~prefix n) ["__type/";"__type-kind/";"__form/";"__form.ir/";"__form.types/";"__form.options/"]
    | _ -> false) syntax in
  match Eval.evaluate_program_with_env env metadata with
  | Error _ as error -> error
  | Ok (_,env) ->
      let invalid_ir=List.find_map (function
        | Ast.List (span,Ast.Symbol (_,"define") :: Ast.Symbol (_,n) :: _) when String.starts_with ~prefix:"__form.ir/" n ->
            (match Env.lookup n env with Some (Value.VSymbol ir) when Env.lookup ("__type/" ^ ir) env=None -> Some (Eval_common.diagnostic ~span "surface/invalid-form" ("Unknown IR type " ^ ir)) | _ -> None)
        | _ -> None) metadata in
      match invalid_ir with Some diagnostic -> Error [diagnostic] | None ->
      let declarations=List.filter (fun expr -> match Surface.head expr with Some form -> Env.lookup ("__form/" ^ form) env<>None | None -> false) syntax in
      Eval.evaluate_program_with_env env declarations |> Result.map snd

let unified_context env syntax =
  match load_unified_context env syntax with Ok env -> env | Error _ -> env

let unified_declaration env syntax (application : Descriptor_protocol.descriptor_application) =
  if Env.lookup ("__form/" ^ application.form_name) env=None then None else
  Option.map (fun expr -> expr,Eval.evaluate_program_with_env env [expr])
    (List.find_opt (fun expr -> Ast.expr_span expr=application.span) syntax)

let validate_unified_forms env syntax =
  match load_unified_context env syntax with
  | Error ds -> Error (List.map eval_diagnostic_to_type ds)
  | Ok env ->
  let rec loop = function
    | [] -> Ok ()
    | (Ast.List (_,Ast.Symbol (_,form) :: _) as expr) :: rest when Env.lookup ("__form/" ^ form) env<>None ->
        (match Eval.evaluate_program_with_env env [expr] with
         | Error ds -> Error (List.map eval_diagnostic_to_type ds)
         | Ok (declaration,_) ->
             (match Eval_meta.with_lookup_declaration (fun n->Env.lookup n env) (fun () -> Form_semantics.validate ~syntax:expr ~span:(Ast.expr_span expr) env declaration) with
              | Error ds -> Error (List.map eval_diagnostic_to_type ds)
              | Ok _ ->
                  match Descriptor.construct_hook env form with
                  | None -> loop rest
                  | Some hook ->
                      match Eval_meta.with_lookup_declaration (fun n->Env.lookup n env) (fun () -> Eval.apply_named env hook declaration) with
                      | Ok _ -> loop rest
                      | Error ds -> Error (List.map (fun (d:Eval_common.diagnostic) -> eval_diagnostic_to_type {d with span=Some (Ast.expr_span expr)}) ds)))
    | _ :: rest -> loop rest in
  loop syntax

let descriptor_hooks ?(syntax=[]) env =
  let env=unified_context env syntax in
  let typed_slots application = match unified_declaration env syntax application with
    | None -> check_typed_slots env application
    | Some (_,Error ds) -> Error (List.map eval_diagnostic_to_type ds)
    | Some (expr,Ok (declaration,_)) ->
        Eval_meta.with_lookup_declaration (fun n->Env.lookup n env) (fun () ->
          Form_semantics.validate ~syntax:expr ~span:application.span env declaration)
        |> Result.map (fun _ -> ()) |> Result.map_error (List.map eval_diagnostic_to_type) in
  let result_type application = match unified_declaration env syntax application with
    | Some (_,Ok (declaration,_)) ->
        (match Descriptor.result_type_hook env application.form_name with
         | None -> result_type env application
         | Some hook ->
             (match Eval_meta.with_lookup_declaration (fun n->Env.lookup n env) (fun () -> Eval.apply_named env hook declaration) with
              | Error ds -> Error (List.map eval_diagnostic_to_type ds)
              | Ok value -> Form_semantics.resolve_type value |> Result.map Option.some |> Result.map_error (List.map eval_diagnostic_to_type)))
    | _ -> result_type env application in
  Descriptor_protocol.{ bindings=bindings env;typed_slots;result_type;infer=descriptor_infer_type env;check=descriptor_check_type env }
