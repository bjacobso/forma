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

val open_ : unit -> t
val find : string -> t option
val close : t -> unit
val reset : t -> unit
val fresh_input_id : string -> string
val fresh_evaluation_id : t -> string
val fresh_call_id : t -> string
val fresh_value_ref_id : t -> string
val remember_pending_evaluation : t -> string -> pending_evaluation -> unit
val find_pending_evaluation : t -> string -> pending_evaluation option
val remove_pending_evaluation : t -> string -> unit
val remember_value_ref : t -> string -> Eval.value -> unit
val find_value_ref : t -> string -> Eval.value option
val remove_value_ref : t -> string -> unit
val prelude_fingerprint : t -> string
val remember_source_order : t -> string -> unit
val env_without_source_bindings : t -> string -> Eval.env * Type_env.env
val cache_source_bindings : t -> source_id:string -> string list -> unit
val invalidate_artifacts : t -> unit
val invalidate_artifacts_from_source :
  ?public_exports_changed:bool -> t -> string -> unit

val invalidate_source_artifact : t -> string -> unit

val cache_artifact_declarations :
  t ->
  source_id:string ->
  validation_diagnostic_count:int ->
  Packageable_declaration.t list ->
  unit
