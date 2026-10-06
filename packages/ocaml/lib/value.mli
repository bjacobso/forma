type t =
  | VNil
  | VBool of bool
  | VInt of int
  | VFloat of float
  | VString of string
  | VSymbol of string
  | VKeyword of string
  | VList of t list
  | VVector of t list
  | VMap of (t * t) list
  | VDictionary of (t * t) list
  | VClosure of closure
  | VMacro of closure

and closure = {
  params : string list;
  rest_param : string option;
  body : Ast.expr list;
  env : (string * t) list;
}

val json_escape : string -> string
val string_json : string -> string
val to_json : t -> string
val truthy : t -> bool
val equal : t -> t -> bool
val to_str_part : t -> string
val to_format_part : t -> string
val concat_string : t list -> t
val key_candidates : t -> t list
val lookup_map : (t * t) list -> t -> t option
val length_key : t -> bool
val lookup_path_segment : t -> t -> t
