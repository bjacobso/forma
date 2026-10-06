type value = Value.t

val scalar_string : value -> string option
val declaration_args : value -> value list
val declaration_form : value -> string option
val declaration_name : value -> string option

val slot_spec_with_lookup :
  lookup:(string -> value option) -> value -> string -> Descriptor.typed_slot option

val slot_values_with_lookup :
  lookup:(string -> value option) -> value -> value -> value list

val slot_values : value -> value -> value list
val string_list_value : value -> value
val child_form_value : value -> string -> value -> value

val child_forms_with_lookup :
  lookup:(string -> value option) -> value -> value -> value list

val child_forms : value -> value -> value list
val positional_args : value -> value list
val positional_arg : value -> int -> value
val option_map_lookup : value -> string -> value option

val identifier_value_with_lookup :
  lookup:(string -> value option) -> value -> value -> value

val identifier_value : value -> value -> value

val slot_value_with_lookup :
  lookup:(string -> value option) -> value -> value -> value

val slot_value : value -> value -> value

val normalized_form_with_lookup :
  lookup:(string -> value option) -> value -> value

val normalized_form : value -> value
