type source_bundle_item = { kind : string; source_id : string; source : string }
type unbound_symbol_match = { kind : string; value : string }

type unbound_symbol_policy = {
  match_ : unbound_symbol_match;
  type_kind : string option;
  type_name : string;
  reason : string option;
}

type type_policy = {
  unbound_symbols : unbound_symbol_policy list;
  default_builtin_scheme : string option;
}

type type_scheme_expr =
  | Scheme_type of string
  | Scheme_function of type_scheme_expr list * type_scheme_expr
  | Scheme_variadic_function of
      type_scheme_expr list * type_scheme_expr * type_scheme_expr
  | Scheme_list of type_scheme_expr
  | Scheme_map of type_scheme_expr * type_scheme_expr
  | Scheme_any
  | Scheme_unsupported of string

type host_builtin_descriptor = {
  name : string;
  effect_name : string option;
  type_scheme : type_scheme_expr option;
}

type t = {
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

val find_string_field : string -> string -> string option
val find_int_field : string -> string -> int option
val find_bool_field : string -> string -> bool option
val find_object_field : string -> string -> string option
val find_array_field : string -> string -> string option
val split_top_level_objects : string -> string list
val decode : string -> (t, string list) result
