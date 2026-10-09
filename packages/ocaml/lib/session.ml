type artifact_cache_entry = {
  source_hash : string;
  prelude_fingerprint : string;
  declarations : Packageable_declaration.t list;
  validation_diagnostic_count : int;
}

type t = {
  id : string;
  preludes : (string, Source.t) Hashtbl.t;
  sources : (string, Source.t) Hashtbl.t;
  parsed_preludes : (string, Ast.expr list) Hashtbl.t;
  parsed_sources : (string, Ast.expr list) Hashtbl.t;
  artifact_declarations : (string, artifact_cache_entry) Hashtbl.t;
  source_bindings : (string, string list) Hashtbl.t;
  source_modules : (string, Module_decl.t) Hashtbl.t;
  module_instances : (string, Module_runtime.instance) Hashtbl.t;
  source_exports : (string, string list) Hashtbl.t;
  source_dependencies : (string, string list) Hashtbl.t;
  source_order : (string, int) Hashtbl.t;
  mutable next_source_order : int;
  mutable next_evaluation_id : int;
  mutable next_call_id : int;
  mutable next_value_ref_id : int;
  pending_evaluations : (string, pending_evaluation) Hashtbl.t;
  value_refs : (string, Eval.value) Hashtbl.t;
  mutable projects : Module_contract.project list;
  mutable core_env : Eval.env;
  mutable core_types : Type_env.env;
  mutable env : Eval.env;
  mutable type_env : Type_env.env;
}

and pending_evaluation = { call_id : string; step : Eval_effect.step }

let sessions : (string, t) Hashtbl.t = Hashtbl.create 16
let next_session_id = ref 1
let next_input_id = ref 1

let fresh_id prefix counter =
  let id = Printf.sprintf "%s:%d" prefix !counter in
  incr counter;
  id

let open_ () =
  let id = fresh_id "session" next_session_id in
  let session =
    {
      id;
      preludes = Hashtbl.create 8;
      sources = Hashtbl.create 8;
      parsed_preludes = Hashtbl.create 8;
      parsed_sources = Hashtbl.create 8;
      artifact_declarations = Hashtbl.create 16;
      source_bindings = Hashtbl.create 16;
      source_modules = Hashtbl.create 16;
      module_instances = Hashtbl.create 16;
      source_exports = Hashtbl.create 16;
      source_dependencies = Hashtbl.create 16;
      source_order = Hashtbl.create 16;
      next_source_order = 0;
      next_evaluation_id = 0;
      next_call_id = 0;
      next_value_ref_id = 0;
      pending_evaluations = Hashtbl.create 8;
      value_refs = Hashtbl.create 16;
      projects = [];
      core_env = Env.empty;
      core_types = [];
      env = Env.empty;
      type_env = [];
    }
  in
  Hashtbl.replace sessions id session;
  session

let find id = Hashtbl.find_opt sessions id
let close session = Hashtbl.remove sessions session.id

let reset session =
  Hashtbl.clear session.preludes;
  Hashtbl.clear session.sources;
  Hashtbl.clear session.parsed_preludes;
  Hashtbl.clear session.parsed_sources;
  Hashtbl.clear session.artifact_declarations;
  Hashtbl.clear session.source_bindings;
  Hashtbl.clear session.source_modules;
  Hashtbl.clear session.module_instances;
  Hashtbl.clear session.source_exports;
  Hashtbl.clear session.source_dependencies;
  Hashtbl.clear session.source_order;
  Hashtbl.clear session.pending_evaluations;
  Hashtbl.clear session.value_refs;
  session.next_source_order <- 0;
  session.next_evaluation_id <- 0;
  session.next_call_id <- 0;
  session.next_value_ref_id <- 0;
  session.projects <- [];
  session.core_env <- Env.empty;
  session.core_types <- [];
  session.env <- Env.empty;
  session.type_env <- []

let fresh_input_id kind = fresh_id kind next_input_id

let fresh_evaluation_id session =
  session.next_evaluation_id <- session.next_evaluation_id + 1;
  Printf.sprintf "ocaml-eval-%d" session.next_evaluation_id

let fresh_call_id session =
  session.next_call_id <- session.next_call_id + 1;
  Printf.sprintf "ocaml-call-%d" session.next_call_id

let fresh_value_ref_id session =
  session.next_value_ref_id <- session.next_value_ref_id + 1;
  Printf.sprintf "ocaml-native-value-%d" session.next_value_ref_id

let remember_pending_evaluation session evaluation_id pending =
  Hashtbl.replace session.pending_evaluations evaluation_id pending

let find_pending_evaluation session evaluation_id =
  Hashtbl.find_opt session.pending_evaluations evaluation_id

let remove_pending_evaluation session evaluation_id =
  Hashtbl.remove session.pending_evaluations evaluation_id

let remember_value_ref session value_ref value =
  Hashtbl.replace session.value_refs value_ref value

let find_value_ref session value_ref =
  Hashtbl.find_opt session.value_refs value_ref

let remove_value_ref session value_ref =
  Hashtbl.remove session.value_refs value_ref

let sorted_hashtbl_keys table =
  Hashtbl.fold (fun key _ keys -> key :: keys) table []
  |> List.sort String.compare

let prelude_fingerprint session =
  sorted_hashtbl_keys session.preludes
  |> List.filter_map (fun id ->
      Hashtbl.find_opt session.preludes id
      |> Option.map (fun source ->
          Printf.sprintf "%s:%s" id (Source.hash source)))
  |> String.concat "|"

let remember_source_order session source_id =
  if not (Hashtbl.mem session.source_order source_id) then (
    Hashtbl.replace session.source_order source_id session.next_source_order;
    session.next_source_order <- session.next_source_order + 1)

let remove_type_binding_names names bindings =
  bindings |> List.filter (fun (name, _) -> not (List.mem name names))

let env_without_source_bindings session source_id =
  match Hashtbl.find_opt session.source_bindings source_id with
  | None -> (session.env, session.type_env)
  | Some names ->
      ( Env.remove_names names session.env,
        remove_type_binding_names names session.type_env )

let cache_source_bindings session ~source_id names =
  let names = List.sort_uniq String.compare names in
  if names = [] then Hashtbl.remove session.source_bindings source_id
  else Hashtbl.replace session.source_bindings source_id names

let clear_artifact_graph session =
  Hashtbl.clear session.source_exports;
  Hashtbl.clear session.source_dependencies

let invalidate_artifacts session =
  Hashtbl.clear session.artifact_declarations;
  clear_artifact_graph session

let remove_artifact_cache session source_id =
  Hashtbl.remove session.artifact_declarations source_id;
  Hashtbl.remove session.source_dependencies source_id

let rec expr_reference_atoms = function
  | Ast.Symbol (_, name) | Ast.String (_, name) | Ast.Keyword (_, name) ->
      [ name ]
  | Ast.List (_, exprs) | Ast.Vector (_, exprs) ->
      List.concat_map expr_reference_atoms exprs
  | Ast.Map (_, entries) ->
      entries
      |> List.concat_map (fun (key, value) ->
          expr_reference_atoms key @ expr_reference_atoms value)
  | Ast.Nil _ | Ast.Bool _ | Ast.Int _ | Ast.Float _ -> []

let source_export_names session source_id declarations =
  let declared_names =
    declarations
    |> List.filter_map (fun declaration ->
        Packageable_declaration.summary declaration
        |> Artifact_summary_types.declaration_summary_name)
    |> List.sort_uniq String.compare
  in
  match Hashtbl.find_opt session.source_modules source_id with
  | Some module_decl
    when module_decl.Module_decl.explicit_exports <> []
         || module_decl.Module_decl.re_exports <> [] ->
      (module_decl.Module_decl.explicit_exports
      |> List.filter (fun name -> List.mem name declared_names))
      @ List.concat_map
          (fun (re_export : Module_decl.module_re_export) -> re_export.names)
          module_decl.Module_decl.re_exports
      |> List.sort_uniq String.compare
  | _ -> []

let exported_names_by_source session source_id =
  Hashtbl.fold
    (fun owner names exports ->
      if owner = source_id then exports
      else
        List.fold_left
          (fun exports name -> (name, owner) :: exports)
          exports names)
    session.source_exports []

let source_dependencies session source_id exprs =
  let imports =
    exprs
    |> List.filter_map (function
      | Ast.List
          ( _,
            Ast.Symbol (_, ("import" | "export-from"))
            :: Ast.String (_, specifier)
            :: _ )
        when String.starts_with ~prefix:"./" specifier
             || String.starts_with ~prefix:"../" specifier ->
          Some (Module_graph.relative_id specifier source_id)
      | _ -> None)
  in
  (* Artifact data references (including global seed IDs) are separate from
     lexical imports. Track their cache dependencies without publishing values. *)
  let references = List.concat_map expr_reference_atoms exprs in
  let data =
    Hashtbl.fold
      (fun owner syntax dependencies ->
        if owner = source_id then dependencies
        else
          let syntax =
            List.filter (fun e -> not (Module_graph.directive e)) syntax
            |> Surface_action.program
            |> List.filter (function
              | Ast.List (_, Ast.Symbol (_, form) :: _) ->
                  Descriptor.is_form_descriptor session.core_env form
              | _ -> false)
          in
          let names = Source_bindings.names session.core_env syntax in
          if List.exists (fun n -> List.mem n references) names then
            owner :: dependencies
          else dependencies)
      session.parsed_sources []
  in
  List.sort_uniq String.compare (imports @ data)

let refresh_dependency_graph session =
  Hashtbl.iter
    (fun source_id exprs ->
      Hashtbl.replace session.source_dependencies source_id
        (source_dependencies session source_id exprs))
    session.parsed_sources

let graph_has_all_cached_sources session =
  Hashtbl.fold
    (fun source_id _ ok ->
      ok && Hashtbl.mem session.source_dependencies source_id)
    session.artifact_declarations true

let source_order_stale_sources session source_id =
  match Hashtbl.find_opt session.source_order source_id with
  | None -> None
  | Some changed_order ->
      Some
        (Hashtbl.fold
           (fun id order ids ->
             if order >= changed_order then id :: ids else ids)
           session.source_order [])

let graph_stale_sources session source_id =
  let rec visit seen = function
    | [] -> seen
    | current :: rest when List.mem current seen -> visit seen rest
    | current :: rest ->
        let dependents =
          Hashtbl.fold
            (fun candidate dependencies dependents ->
              if List.mem current dependencies then candidate :: dependents
              else dependents)
            session.source_dependencies []
        in
        visit (current :: seen) (dependents @ rest)
  in
  visit [] [ source_id ]

let invalidate_artifacts_from_source ?(public_exports_changed = true) session
    source_id =
  let stale =
    if not public_exports_changed then [ source_id ]
    else if graph_has_all_cached_sources session then
      graph_stale_sources session source_id
    else
      match source_order_stale_sources session source_id with
      | Some stale -> stale
      | None -> sorted_hashtbl_keys session.artifact_declarations
  in
  List.iter (remove_artifact_cache session) stale;
  if public_exports_changed then Hashtbl.remove session.source_exports source_id;
  refresh_dependency_graph session

let invalidate_source_artifact session source_id =
  remove_artifact_cache session source_id;
  Hashtbl.remove session.source_exports source_id;
  refresh_dependency_graph session

let cache_artifact_declarations session ~source_id ~validation_diagnostic_count
    declarations =
  match Hashtbl.find_opt session.sources source_id with
  | None -> ()
  | Some source ->
      Hashtbl.replace session.artifact_declarations source_id
        {
          source_hash = Source.hash source;
          prelude_fingerprint = prelude_fingerprint session;
          declarations;
          validation_diagnostic_count;
        };
      Hashtbl.replace session.source_exports source_id
        (source_export_names session source_id declarations);
      refresh_dependency_graph session
