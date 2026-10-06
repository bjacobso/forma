type value = Value.t =
  | VNil
  | VBool of bool
  | VInt of int
  | VFloat of float
  | VString of string
  | VSymbol of string
  | VKeyword of string
  | VList of value list
  | VVector of value list
  | VMap of (value * value) list
  | VDictionary of (value * value) list
  | VClosure of Value.closure
  | VMacro of Value.closure

type slot_compile_kind = Eval_meta_protocol_component_model.slot_compile_kind =
  | Expr
  | Json
  | NodeList
  | Value

type name_normalization =
      Eval_meta_protocol_component_model.name_normalization =
  | Preserve
  | CamelCase

type slot_compile_spec =
      Eval_meta_protocol_component_model.slot_compile_spec = {
  field : string;
  kind : slot_compile_kind;
}

type children_policy = Eval_meta_protocol_component_model.children_policy =
  | Any_children
  | No_children
  | Only_children of string list

type component_spec = Eval_meta_protocol_component_model.component_spec = {
  type_field : string option;
  slots : (string * slot_compile_spec) list;
  aliases : (string * string) list;
  events : (string * string) list;
  allows_bind : bool;
  children_policy : children_policy option;
  parents : string list;
  required_children : bool;
  required_bind : bool;
  events_field : string option;
  props_field : string option;
  children_field : string option;
  positional_prop : string option;
  expr_props : string list;
  unknown_props_kind : slot_compile_kind option;
}

type compile_field_names = {
  compile_field : string;
  children_policy_field : string;
  parents_field : string;
  allows_bind_field : string;
  json_slots_field : string;
  node_slots_field : string;
  expr_props_field : string;
  unknown_props_field : string;
  required_children_field : string;
  required_bind_field : string;
  field_overrides_field : string;
  event_overrides_field : string;
  positional_prop_field : string;
  events_field : string;
  type_field_field : string;
  events_section_field : string;
  props_section_field : string;
  children_section_field : string;
}

type slot_compile_defaults = {
  default_form_slot_kind : slot_compile_kind;
  default_value_slot_kind : slot_compile_kind;
  default_expr_slot_kind : slot_compile_kind;
}

type component_compile_contract = {
  extension_key : string;
  prop_name_normalization : name_normalization;
  field_names : compile_field_names;
  slot_defaults : slot_compile_defaults;
}

type compile_metadata = {
  type_field : string option;
  allows_bind : bool;
  children_policy : children_policy option;
  parents : string list;
  json_slots : string list;
  node_slots : string list;
  expr_props : string list;
  unknown_props_kind : slot_compile_kind option;
  required_children : bool;
  required_bind : bool;
  field_overrides : (string * string) list;
  event_overrides : (string * string) list;
  positional_prop : string option;
  events : (string * string) list;
  events_field : string option;
  props_field : string option;
  children_field : string option;
}

type form_metadata = {
  type_field : string option;
  allows_bind : bool;
  children_policy : children_policy option;
  parents : string list;
  positional_prop : string option;
  events_field : string option;
  props_field : string option;
  children_field : string option;
}

type extension_metadata = {
  json_slots : string list;
  node_slots : string list;
  expr_props : string list;
  unknown_props_kind : slot_compile_kind option;
  required_children : bool;
  required_bind : bool;
  field_overrides : (string * string) list;
  event_overrides : (string * string) list;
}

module Util = Eval_meta_util
module Model = Eval_meta_protocol_component_model

let key_string = Util.key_string

let option_value field_name extension =
  Util.option_value (":" ^ field_name) extension

let slot_compile_kind_of_typed_slot contract (slot : Descriptor.typed_slot)
    json_slots node_slots =
  if List.mem slot.name node_slots then NodeList
  else if List.mem slot.name json_slots then Json
  else if slot.mode = Descriptor.Form then
    contract.slot_defaults.default_form_slot_kind
  else if slot.mode = Descriptor.Value then
    contract.slot_defaults.default_value_slot_kind
  else contract.slot_defaults.default_expr_slot_kind

let parse_string_list = function
  | Some (VList values) | Some (VVector values) ->
      List.filter_map key_string values
  | _ -> []

let parse_string_record = function
  | Some (VMap entries) ->
      entries
      |> List.filter_map (fun (key, value) ->
          match (key_string key, key_string value) with
          | Some key, Some value -> Some (key, value)
          | _ -> None)
  | _ -> []

let parse_event_entries normalization = function
  | Some (VMap entries) ->
      entries
      |> List.filter_map (fun (key, value) ->
          match (key_string key, key_string value) with
          | Some raw_key, Some field -> Some (raw_key, field)
          | _ -> None)
  | Some (VList values) | Some (VVector values) ->
      values
      |> List.filter_map (fun value ->
          Option.map
            (fun raw_key ->
              (raw_key, Model.normalize_key normalization raw_key))
            (key_string value))
  | _ -> []

let parse_children_policy = function
  | Some (VSymbol "any") | Some (VKeyword "any") | Some (VString "any") ->
      Some Any_children
  | Some (VSymbol "none") | Some (VKeyword "none") | Some (VString "none") ->
      Some No_children
  | Some (VList [ VSymbol "only"; (VList types | VVector types) ])
  | Some (VVector [ VSymbol "only"; (VList types | VVector types) ])
  | Some (VList [ VKeyword "only"; (VList types | VVector types) ])
  | Some (VVector [ VKeyword "only"; (VList types | VVector types) ])
  | Some (VList [ VString "only"; (VList types | VVector types) ])
  | Some (VVector [ VString "only"; (VList types | VVector types) ]) ->
      let types = List.filter_map key_string types in
      Some (Only_children types)
  | _ -> None

let parse_slot_compile_kind = function
  | Some (VSymbol "expr") | Some (VKeyword "expr") | Some (VString "expr") ->
      Some Expr
  | Some (VSymbol "json") | Some (VKeyword "json") | Some (VString "json") ->
      Some Json
  | Some (VSymbol "node-list")
  | Some (VKeyword "node-list")
  | Some (VString "node-list") ->
      Some NodeList
  | Some (VSymbol "value") | Some (VKeyword "value") | Some (VString "value") ->
      Some Value
  | _ -> None

let parse_bool = function Some (VBool value) -> value | _ -> false
let parse_key = function Some value -> key_string value | None -> None

let compile_extension_value fields extension field_name =
  Option.bind
    (option_value fields.compile_field extension)
    (option_value field_name)

let compile_form_metadata fields extension =
  let type_field = parse_key (option_value fields.type_field_field extension) in
  let allows_bind =
    parse_bool (option_value fields.allows_bind_field extension)
  in
  let children_policy =
    parse_children_policy (option_value fields.children_policy_field extension)
  in
  let parents =
    parse_string_list (option_value fields.parents_field extension)
  in
  let positional_prop =
    parse_key (option_value fields.positional_prop_field extension)
  in
  let events_field =
    parse_key (option_value fields.events_section_field extension)
  in
  let props_field =
    parse_key (option_value fields.props_section_field extension)
  in
  let children_field =
    parse_key (option_value fields.children_section_field extension)
  in
  {
    type_field;
    allows_bind;
    children_policy;
    parents;
    positional_prop;
    events_field;
    props_field;
    children_field;
  }

let compile_extension_metadata contract fields extension =
  let compile_extension_value = compile_extension_value fields extension in
  let json_slots =
    parse_string_list (compile_extension_value fields.json_slots_field)
  in
  let node_slots =
    parse_string_list (compile_extension_value fields.node_slots_field)
  in
  let expr_props =
    parse_string_list (compile_extension_value fields.expr_props_field)
    |> List.map (Model.normalize_key contract.prop_name_normalization)
    |> List.sort_uniq String.compare
  in
  let unknown_props_kind =
    parse_slot_compile_kind (compile_extension_value fields.unknown_props_field)
  in
  let required_children =
    parse_bool (compile_extension_value fields.required_children_field)
  in
  let required_bind =
    parse_bool (compile_extension_value fields.required_bind_field)
  in
  let field_overrides =
    parse_string_record (compile_extension_value fields.field_overrides_field)
  in
  let event_overrides =
    parse_string_record (compile_extension_value fields.event_overrides_field)
  in
  {
    json_slots;
    node_slots;
    expr_props;
    unknown_props_kind;
    required_children;
    required_bind;
    field_overrides;
    event_overrides;
  }

let compile_metadata_of_extension contract extension =
  let fields = contract.field_names in
  let form_metadata = compile_form_metadata fields extension in
  let extension_metadata =
    compile_extension_metadata contract fields extension
  in
  let events =
    parse_event_entries contract.prop_name_normalization
      (option_value fields.events_field extension)
  in
  ({
     type_field = form_metadata.type_field;
     allows_bind = form_metadata.allows_bind;
     children_policy = form_metadata.children_policy;
     parents = form_metadata.parents;
     json_slots = extension_metadata.json_slots;
     node_slots = extension_metadata.node_slots;
     expr_props = extension_metadata.expr_props;
     unknown_props_kind = extension_metadata.unknown_props_kind;
     required_children = extension_metadata.required_children;
     required_bind = extension_metadata.required_bind;
     field_overrides = extension_metadata.field_overrides;
     event_overrides = extension_metadata.event_overrides;
     positional_prop = form_metadata.positional_prop;
     events;
     events_field = form_metadata.events_field;
     props_field = form_metadata.props_field;
     children_field = form_metadata.children_field;
   }
    : compile_metadata)

let canonical_slot_name contract (slot : Descriptor.typed_slot) =
  Model.normalize_key contract.prop_name_normalization slot.name

let slot_alias_entries contract canonical (slot : Descriptor.typed_slot) =
  let slot_aliases =
    slot.aliases
    |> List.map (Model.normalize_key contract.prop_name_normalization)
  in
  (canonical, canonical)
  :: List.map (fun alias -> (alias, canonical)) slot_aliases

let slot_spec_of_typed_slot contract (metadata : compile_metadata)
    (slot : Descriptor.typed_slot) =
  let canonical = canonical_slot_name contract slot in
  let field =
    Option.value ~default:canonical
      (List.assoc_opt slot.name metadata.field_overrides)
  in
  let spec =
    {
      field;
      kind =
        slot_compile_kind_of_typed_slot contract slot metadata.json_slots
          metadata.node_slots;
    }
  in
  let aliases = slot_alias_entries contract canonical slot in
  ((canonical, spec), aliases)

let compile_slots contract (metadata : compile_metadata) typed_slots =
  typed_slots
  |> List.fold_left
       (fun (slots, aliases) slot ->
         let slot_entry, slot_aliases =
           slot_spec_of_typed_slot contract metadata slot
         in
         (slot_entry :: slots, slot_aliases @ aliases))
       ([], [])

let compile_events (metadata : compile_metadata) =
  metadata.events
  |> List.map (fun (event, field) ->
      let field =
        Option.value ~default:field
          (List.assoc_opt event metadata.event_overrides)
      in
      (event, field))

let build_component_spec contract (metadata : compile_metadata) typed_slots =
  let slots, aliases = compile_slots contract metadata typed_slots in
  let events = compile_events metadata in
  {
    type_field = metadata.type_field;
    slots;
    aliases;
    events;
    allows_bind = metadata.allows_bind;
    children_policy = metadata.children_policy;
    parents = metadata.parents;
    required_children = metadata.required_children;
    required_bind = metadata.required_bind;
    events_field = metadata.events_field;
    props_field = metadata.props_field;
    children_field = metadata.children_field;
    positional_prop = metadata.positional_prop;
    expr_props = metadata.expr_props;
    unknown_props_kind = metadata.unknown_props_kind;
  }

let parse_component_spec contract (form : Descriptor.form) =
  Util.extension_spec_of_form ~extension_key:contract.extension_key
    (fun extension ->
      let metadata = compile_metadata_of_extension contract extension in
      Some (build_component_spec contract metadata form.typed_slots))
    form

let build_component_specs_from_forms forms contract =
  let component_spec_of_form (form : Descriptor.form) =
    Option.map
      (fun spec -> (form.name, spec))
      (parse_component_spec contract form)
  in
  Util.collect_unique_form_specs component_spec_of_form forms
