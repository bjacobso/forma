val value_keyword : string -> Value.t -> Value.t option
val value_text : Value.t -> string option
val kind : Value.t -> string option

type diagnostic = Descriptor_validation.diagnostic = {
  span : Ast.span option;
  code : string;
  message : string;
}

type typed_child_slot = {
  name : string;
  kind : string;
  typ : Value.t option;
  positional_index : int option;
}

type identifier_spec = { name : string; positional_index : int }
type slot_mode = Value | Expr | Form

type typed_slot = {
  name : string;
  mode : slot_mode;
  many : bool;
  typ : Value.t option;
  aliases : string list;
  child_identifiers : identifier_spec list;
  child_slots : typed_child_slot list;
}

type hooks = {
  bindings : string option;
  construct : string option;
  result_type : string option;
  infer : string option;
  check : string option;
}

type construct_field = { name : string; expr : Value.t; optional : bool }
type declaration_type = Constant of Value.t | Row

type form = {
  name : string;
  clauses : Value.t list;
  identifiers : identifier_spec list;
  extensions : (string * Value.t) list;
  result_type : Value.t option;
  declaration_type : declaration_type option;
  construct_kind : string option;
  construct_fields : construct_field list;
  typed_slots : typed_slot list;
  hooks : hooks;
  constructed_by : string option;
  constructed_child : string option;
}

val declaration_value : string -> string -> Ast.expr list -> Value.t
val application_value : string -> Ast.expr list -> Value.t
val application_values : string -> Value.t list -> Value.t
val validate_form_clauses : Ast.expr list -> (unit, diagnostic list) result
val validate_meta_fn_clauses : Ast.expr list -> (unit, diagnostic list) result
val validate_application_slots : form -> Ast.expr list -> (unit, diagnostic list) result
val is_form_descriptor : Env.t -> string -> bool
val declaration_binding_name : Ast.expr list -> string option
val meta_fn_body : Ast.expr list -> Ast.expr list option
val declaration_form : Value.t -> string option
val form_of_descriptor : string -> Value.t -> form option

val form_with_lookup :
  lookup:(string -> Value.t option) -> string -> form option

val form : Env.t -> string -> form option
val forms : Env.t -> form list
val slot_in_form : form -> string -> typed_slot option
val child_identifiers_in_form : form -> string -> identifier_spec list
val child_slots_in_form : form -> string -> typed_child_slot list
val identifier_index_in_form : form -> string -> int option
val extension_in_form : form -> string -> Value.t option
val extension_in_descriptor : Value.t -> string -> Value.t option
val declaration_type_in_descriptor : Value.t -> declaration_type option
val construct_kind_in_descriptor : Value.t -> string option
val construct_fields_in_descriptor : Value.t -> construct_field list
val child_identifiers_in_descriptor : Value.t -> string -> identifier_spec list
val child_slots_in_descriptor : Value.t -> string -> typed_child_slot list
val identifier_index_in_descriptor : Value.t -> string -> int option
val identifiers : Env.t -> string -> identifier_spec list
val identifier_index : Env.t -> string -> string -> int option
val typed_slots : Env.t -> string -> typed_slot list
val result_type : Env.t -> string -> Value.t option
val result_type_hook : Env.t -> string -> string option
val declaration_type : Env.t -> string -> declaration_type option
val construct_kind : Env.t -> string -> string option
val construct_fields : Env.t -> string -> construct_field list
val bindings_hook : Env.t -> string -> string option
val infer_hook : Env.t -> string -> string option
val check_hook : Env.t -> string -> string option
val construct_hook : Env.t -> string -> string option
