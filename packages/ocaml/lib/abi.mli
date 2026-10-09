type request = {
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
  projects : Module_contract.project list option;
}

and source_bundle_item = { kind : string; source_id : string; source : string }
and unbound_symbol_match = { kind : string; value : string }

and unbound_symbol_policy = {
  match_ : unbound_symbol_match;
  type_kind : string option;
  type_name : string;
  reason : string option;
}

and type_policy = {
  unbound_symbols : unbound_symbol_policy list;
  default_builtin_scheme : string option;
}

and type_scheme_expr =
  | Scheme_type of string
  | Scheme_function of type_scheme_expr list * type_scheme_expr
  | Scheme_variadic_function of
      type_scheme_expr list * type_scheme_expr * type_scheme_expr
  | Scheme_list of type_scheme_expr
  | Scheme_map of type_scheme_expr * type_scheme_expr
  | Scheme_any
  | Scheme_unsupported of string

and host_builtin_descriptor = {
  name : string;
  effect_name : string option;
  type_scheme : type_scheme_expr option;
}

val engine_name : string
(** The editor-services operations are post Move-D authoring-loop projections
    over existing parse/typecheck/session paths. They do not add language
    surface or backend behavior. *)

val engine_version : string
val handle_json : string -> string
