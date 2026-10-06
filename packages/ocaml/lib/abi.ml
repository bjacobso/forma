type source_bundle_item = Abi_request.source_bundle_item = {
  kind : string;
  source_id : string;
  source : string;
}

type unbound_symbol_match = Abi_request.unbound_symbol_match = {
  kind : string;
  value : string;
}

type unbound_symbol_policy = Abi_request.unbound_symbol_policy = {
  match_ : unbound_symbol_match;
  type_kind : string option;
  type_name : string;
  reason : string option;
}

type type_policy = Abi_request.type_policy = {
  unbound_symbols : unbound_symbol_policy list;
  default_builtin_scheme : string option;
}

type type_scheme_expr = Abi_request.type_scheme_expr =
  | Scheme_type of string
  | Scheme_function of type_scheme_expr list * type_scheme_expr
  | Scheme_variadic_function of
      type_scheme_expr list * type_scheme_expr * type_scheme_expr
  | Scheme_list of type_scheme_expr
  | Scheme_map of type_scheme_expr * type_scheme_expr
  | Scheme_any
  | Scheme_unsupported of string

type host_builtin_descriptor = Abi_request.host_builtin_descriptor = {
  name : string;
  effect_name : string option;
  type_scheme : type_scheme_expr option;
}

type request = Abi_request.t = {
  op : string;
  kind : string option;
  source_id : string option;
  source_ids : string list option;
  source : string option;
  source_bundle : source_bundle_item list option;
  session_id : string option;
  backend : string option;
  token : int option;
  offset : int option;
  result : string option;
  evaluation_id : string option;
  call_id : string option;
  resume_ok : bool option;
  value_json : string option;
  value_ref : string option;
  value_refs : string list;
  args_json : string list;
  failure_code : string option;
  failure_message : string option;
  type_policy : type_policy option;
  host_builtins : host_builtin_descriptor list;
}

let engine_name = "forma-ocaml"
let engine_version = "0.1.0"

module Response = Abi_response

let version_json () =
  Response.object_json
    [
      Response.string_field "engine" engine_name;
      Response.string_field "version" engine_version;
    ]

let open_session = Abi_session_ops.open_session
let with_session = Abi_session_ops.with_session
let close_session = Abi_session_ops.close_session
let reset_session = Abi_session_ops.reset_session
let load_prelude = Abi_session_ops.load_prelude
let load_source = Abi_session_ops.load_source
let load_source_bundle = Abi_session_ops.load_source_bundle
let repl_submit = Abi_session_ops.repl_submit
let session_summary = Abi_session_ops.session_summary
let source_summary = Abi_session_ops.source_summary
let parse_source = Abi_source_ops.parse_source
let parse_ast_source = Abi_source_ops.parse_ast_source
let parse_summary = Abi_source_ops.parse_summary
let expand_source request = Abi_source_ops.expand_source ~with_session request

let lower_core_source request =
  Abi_source_ops.lower_core_source ~with_session request

let typecheck_core_source ?(typed = false) request =
  Abi_source_ops.typecheck_core_source ~typed ~with_session request

let evaluate_source request =
  Abi_source_ops.evaluate_source ~with_session request

let typecheck_source request =
  Abi_source_ops.typecheck_source ~with_session request

let elaborate_source request =
  Abi_source_ops.emitted_values_source ~with_session request

let elaborate_many request =
  Abi_emit_ops.emitted_values_many ~with_session request

let emit_backends_json = Abi_emit_ops.emit_backends_json

let emit_source request =
  Abi_emit_ops.emit_source ~with_session ~engine_name ~engine_version request

let emit_many request =
  Abi_emit_ops.emit_many ~with_session ~engine_name ~engine_version request

let artifact_summary request =
  Abi_emit_ops.artifact_summary ~with_session request

let editor_analyze request = Abi_editor_ops.analyze ~with_session request
let editor_hover request = Abi_editor_ops.hover ~with_session request
let editor_completion request = Abi_editor_ops.completion ~with_session request
let editor_definition request = Abi_editor_ops.definition ~with_session request
let editor_format request = Abi_editor_ops.format ~with_session request
let decode_request = Abi_request.decode

let dispatch_request request =
  match request.op with
  | "version" -> version_json ()
  | "openSession" -> open_session ()
  | "closeSession" -> close_session request.session_id
  | "resetSession" -> reset_session request.session_id
  | "loadPrelude" -> load_prelude request
  | "loadSource" -> load_source request
  | "loadSourceBundle" -> load_source_bundle request
  | "replSubmit" -> repl_submit request
  | "resumeHostCall" -> Abi_session_ops.resume_host_call request
  | "abortEvaluation" -> Abi_session_ops.abort_evaluation request
  | "callValue" -> Abi_session_ops.call_value request
  | "releaseValue" -> Abi_session_ops.release_value request
  | "sessionInfo" -> with_session request.session_id session_summary
  | "sourceSummary" -> with_session request.session_id source_summary
  | "read" | "parse" -> parse_source request
  | "parseAst" -> parse_ast_source request
  | "expand" -> expand_source request
  | "lowerCore" | "lower" -> lower_core_source request
  | "typecheckCore" -> typecheck_core_source request
  | "typecheckCoreTyped" -> typecheck_core_source ~typed:true request
  | "parseSummary" -> parse_summary request
  | "evaluate" -> evaluate_source request
  | "typecheck" -> typecheck_source request
  | "elaborate" -> elaborate_source request
  | "elaborateMany" -> elaborate_many request
  | "emitBackends" | "listEmitBackends" -> emit_backends_json ()
  | "emit" -> emit_source request
  | "emitMany" -> emit_many request
  | "artifactSummary" -> artifact_summary request
  | "editorAnalyze" -> editor_analyze request
  | "editorHover" -> editor_hover request
  | "editorCompletion" -> editor_completion request
  | "editorDefinition" -> editor_definition request
  | "editorFormat" -> editor_format request
  | "incrementalSummary" ->
      Incremental_abi.summary_json request.source_id request.source
  | op ->
      Response.error_json
        [
          Response.diagnostic_json ~code:"abi/unsupported-op"
            ~message:(Printf.sprintf "Unsupported operation %S." op);
        ]

(* No exception escapes a request. Authoring errors raised while lowering
   surface syntax are located diagnostics; anything else is an engine fault,
   reported as such rather than as a user error. *)
let internal_error_json op exn =
  Response.eval_diagnostics_json
    [ Eval.{ span = None; code = "internal/error";
             message = Printf.sprintf "Internal error while handling %s: %s" op (Printexc.to_string exn) } ]

let handle_request request =
  try
    (match request.source with
     | Some source when List.mem request.op ["evaluate";"eval";"expand";"typecheck";"typecheckCore";"typecheckCoreTyped";"emit";"elaborate"] ->
         (match Reader.parse_ast ~source_id:(Option.value ~default:"request" request.source_id) source with Ok exprs -> Surface.validate_program exprs | Error _ -> ())
     | _ -> ());
    dispatch_request request
  with exn -> (
    match Surface.diagnostic_of_exn exn with
    | Some (span, code, message) -> Response.eval_diagnostics_json [Eval.{span=Some span;code;message}]
    | None -> internal_error_json request.op exn)

let handle_json json =
  match decode_request json with
  | Ok request -> handle_request request
  | Error diagnostics -> Response.error_json diagnostics
  | exception exn -> internal_error_json "request" exn
