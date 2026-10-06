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

module Metadata = Eval_meta_protocol_metadata
module Util = Eval_meta_util

type action_metadata = {
  form_name : string option;
  discriminator_field : string option;
  tag : string option;
  callbacks : Eval_meta_protocol_lowering.action_callback_spec list;
  positional : Eval_meta_protocol_lowering.action_field_spec list;
  keywords : Eval_meta_protocol_lowering.action_field_spec list;
}

type action_callback_metadata = { input_name : string; field : string }

type action_field_metadata = {
  input_name : string;
  field : string;
  kind : Eval_meta_protocol_lowering.action_field_kind;
  optional : bool;
}

type expr_source_metadata = {
  forms : string list;
  sigils : (string * string) list;
}

type expr_op_metadata = {
  form_name : string option;
  spec : Eval_meta_protocol_lowering.expr_op_spec option;
}

type layout_alias_metadata = {
  form_name : string option;
  to_name : string option;
  component_name : string option;
}

type component_protocol_metadata = {
  prop_name_normalization :
    Eval_meta_protocol_component_model.name_normalization option;
  type_field : string option;
  props_field : string option;
  events_field : string option;
  children_field : string option;
  bind_prop : string option;
  required_bind_value : value option;
  scalar_fallback_field : string option;
  scalar_fallback_kind :
    Eval_meta_protocol_component_model.slot_compile_kind option;
  fallback_prop_kind :
    Eval_meta_protocol_component_model.slot_compile_kind option;
}

let scalar_string = Eval_slot.scalar_string
let key_string = Eval_meta_util.key_string
let parse_name_normalization = Metadata.parse_name_normalization
let extension_value = Metadata.extension_value
let extension_key = Metadata.extension_key
let extension_scalar_string = Metadata.extension_scalar_string

let parse_action_field_kind (action_fields : Metadata.action_registry_fields)
    value =
  match key_string value with
  | Some kind_name -> (
      match List.assoc_opt kind_name action_fields.action_field_kinds with
      | Some mechanism ->
          Eval_meta_protocol_lowering.action_field_kind_of_mechanism
            action_fields.action_mechanism_config mechanism
      | None -> None)
  | None -> None

let action_field_spec_of_metadata metadata =
  {
    Eval_meta_protocol_lowering.input_name = metadata.input_name;
    field = metadata.field;
    kind = metadata.kind;
    optional = metadata.optional;
  }

let action_field_metadata_of_values action_fields input_name field_name kind
    optional =
  match
    ( key_string input_name,
      key_string field_name,
      parse_action_field_kind action_fields kind )
  with
  | Some input_name, Some field, Some kind ->
      Some { input_name; field; kind; optional }
  | _ -> None

let parse_action_positional_field_spec action_fields = function
  | VList [ field_name; kind ] | VVector [ field_name; kind ] ->
      action_field_metadata_of_values action_fields field_name field_name kind
        false
      |> Option.map action_field_spec_of_metadata
  | VList [ field_name; kind; optional_flag ]
  | VVector [ field_name; kind; optional_flag ] -> (
      match key_string optional_flag with
      | Some flag ->
          action_field_metadata_of_values action_fields field_name field_name
            kind (flag = "optional")
          |> Option.map action_field_spec_of_metadata
      | None -> None)
  | _ -> None

let parse_action_keyword_field_spec action_fields = function
  | VList [ input_name; field_name; kind ]
  | VVector [ input_name; field_name; kind ] ->
      action_field_metadata_of_values action_fields input_name field_name kind
        false
      |> Option.map action_field_spec_of_metadata
  | VList [ input_name; field_name; kind; optional_flag ]
  | VVector [ input_name; field_name; kind; optional_flag ] -> (
      match key_string optional_flag with
      | Some flag ->
          action_field_metadata_of_values action_fields input_name field_name
            kind (flag = "optional")
          |> Option.map action_field_spec_of_metadata
      | None -> None)
  | _ -> None

let parse_action_positional_fields action_fields = function
  | Some (VList fields) | Some (VVector fields) ->
      List.filter_map (parse_action_positional_field_spec action_fields) fields
  | _ -> []

let parse_action_keyword_fields action_fields = function
  | Some (VList fields) | Some (VVector fields) ->
      List.filter_map (parse_action_keyword_field_spec action_fields) fields
  | _ -> []

let action_callback_spec_of_metadata (metadata : action_callback_metadata) =
  {
    Eval_meta_protocol_lowering.input_name = metadata.input_name;
    field = metadata.field;
  }

let action_callback_metadata_of_values input_name field_name :
    action_callback_metadata option =
  match (key_string input_name, key_string field_name) with
  | Some input_name, Some field -> Some { input_name; field }
  | _ -> None

let parse_action_callback :
    value -> Eval_meta_protocol_lowering.action_callback_spec option = function
  | VList [ input_name; field_name ] | VVector [ input_name; field_name ] ->
      action_callback_metadata_of_values input_name field_name
      |> Option.map action_callback_spec_of_metadata
  | _ -> None

let parse_action_callbacks = function
  | Some (VList callbacks) | Some (VVector callbacks) ->
      List.filter_map parse_action_callback callbacks
  | _ -> []

let action_metadata_of_extension
    (action_fields : Metadata.action_registry_fields) extension :
    action_metadata =
  let field_value field_name = extension_value field_name extension in
  {
    form_name = extension_key action_fields.action_form_field extension;
    discriminator_field =
      extension_key action_fields.action_discriminator_field_field extension;
    tag = extension_key action_fields.action_tag_field extension;
    callbacks =
      parse_action_callbacks (field_value action_fields.action_callbacks_field);
    positional =
      parse_action_positional_fields action_fields
        (field_value action_fields.action_positional_field);
    keywords =
      parse_action_keyword_fields action_fields
        (field_value action_fields.action_keywords_field);
  }

let action_spec_of_metadata (metadata : action_metadata) =
  match (metadata.form_name, metadata.discriminator_field, metadata.tag) with
  | Some action_name, Some discriminator_field, Some tag ->
      Some
        ( action_name,
          {
            Eval_meta_protocol_lowering.discriminator_field;
            Eval_meta_protocol_lowering.tag;
            callbacks = metadata.callbacks;
            positional = metadata.positional;
            keywords = metadata.keywords;
          } )
  | _ -> None

let action_spec_of_form (action_fields : Metadata.action_registry_fields)
    (form : Descriptor.form) =
  Util.extension_spec_of_form ~extension_key:action_fields.action_extension
    (fun extension ->
      action_metadata_of_extension action_fields extension
      |> action_spec_of_metadata)
    form

let build_action_specs_from_forms forms action_fields =
  Util.collect_unique_form_specs (action_spec_of_form action_fields) forms

let parse_expr_op_spec (expr_fields : Metadata.expr_registry_fields) extension =
  match extension_key expr_fields.expr_op_lowering_field extension with
  | Some lowering_name -> (
      match List.assoc_opt lowering_name expr_fields.expr_op_lowerings with
      | Some mechanism ->
          Eval_meta_protocol_lowering.expr_op_spec_of_mechanism
            expr_fields.expr_mechanism_config mechanism
            ?name:(extension_key expr_fields.expr_op_name_field extension)
            ?op:
              (extension_scalar_string expr_fields.expr_op_operator_field
                 extension)
            ()
      | None -> None)
  | None -> None

let expr_op_metadata_of_extension (expr_fields : Metadata.expr_registry_fields)
    extension : expr_op_metadata =
  {
    form_name = extension_key expr_fields.expr_op_form_field extension;
    spec = parse_expr_op_spec expr_fields extension;
  }

let expr_op_spec_of_metadata (metadata : expr_op_metadata) =
  match (metadata.form_name, metadata.spec) with
  | Some form_name, Some spec -> Some (form_name, spec)
  | _ -> None

let expr_op_spec_of_form (expr_fields : Metadata.expr_registry_fields)
    (form : Descriptor.form) =
  Util.extension_spec_of_form ~extension_key:expr_fields.expr_op_extension
    (fun extension ->
      expr_op_metadata_of_extension expr_fields extension
      |> expr_op_spec_of_metadata)
    form

let build_expr_op_config_from_forms forms expr_fields =
  Util.collect_unique_form_specs (expr_op_spec_of_form expr_fields) forms

let layout_alias_metadata_of_extension
    (layout_alias_fields : Metadata.layout_alias_registry_fields) extension :
    layout_alias_metadata =
  {
    form_name =
      extension_key layout_alias_fields.layout_alias_form_field extension;
    to_name =
      extension_scalar_string layout_alias_fields.layout_alias_to_field
        extension;
    component_name =
      extension_scalar_string
        layout_alias_fields.layout_alias_component_name_field extension;
  }

let layout_alias_spec_of_metadata
    (layout_alias_fields : Metadata.layout_alias_registry_fields)
    (metadata : layout_alias_metadata) =
  match metadata.form_name with
  | None -> None
  | Some form_name ->
      Some
        ( form_name,
          {
            Eval_meta_protocol_lowering.to_name =
              Option.value ~default:layout_alias_fields.layout_alias_default_to
                metadata.to_name;
            component_name = metadata.component_name;
          } )

let layout_alias_spec_of_form
    (layout_alias_fields : Metadata.layout_alias_registry_fields)
    (form : Descriptor.form) =
  Util.extension_spec_of_form
    ~extension_key:layout_alias_fields.layout_alias_extension
    (fun extension ->
      layout_alias_metadata_of_extension layout_alias_fields extension
      |> layout_alias_spec_of_metadata layout_alias_fields)
    form

let build_layout_aliases_from_forms forms layout_alias_fields =
  Util.collect_unique_form_specs
    (layout_alias_spec_of_form layout_alias_fields)
    forms

let parse_fallback_prop_kind (slot_fields : Metadata.slot_registry_fields) value
    =
  match key_string value with
  | Some kind_name -> (
      match List.assoc_opt kind_name slot_fields.slot_compile_kinds with
      | Some mechanism ->
          Eval_meta_protocol_component_model.slot_compile_kind_of_mechanism
            slot_fields.slot_compile_mechanism_config mechanism
      | None -> None)
  | None -> None

let component_protocol_metadata_of_extension
    (component_fields : Metadata.component_registry_fields)
    (slot_fields : Metadata.slot_registry_fields) extension :
    component_protocol_metadata =
  {
    prop_name_normalization =
      Option.bind
        (extension_value
           component_fields.component_protocol_prop_name_normalization_field
           extension) (fun value ->
          key_string value |> parse_name_normalization);
    type_field =
      extension_key component_fields.component_protocol_type_field_field
        extension;
    props_field =
      extension_key component_fields.component_protocol_props_field_field
        extension;
    events_field =
      extension_key component_fields.component_protocol_events_field_field
        extension;
    children_field =
      extension_key component_fields.component_protocol_children_field_field
        extension;
    bind_prop =
      extension_key component_fields.component_protocol_bind_prop_field_field
        extension;
    required_bind_value =
      extension_value
        component_fields.component_protocol_required_bind_value_field_field
        extension;
    scalar_fallback_field =
      extension_key
        component_fields.component_protocol_scalar_fallback_field_field
        extension;
    scalar_fallback_kind =
      Option.bind
        (extension_value
           component_fields.component_protocol_scalar_fallback_kind_field_field
           extension)
        (parse_fallback_prop_kind slot_fields);
    fallback_prop_kind =
      Option.bind
        (extension_value component_fields.component_protocol_unknown_props_field
           extension)
        (parse_fallback_prop_kind slot_fields);
  }

let component_protocol_of_metadata
    (component_fields : Metadata.component_registry_fields)
    (metadata : component_protocol_metadata) =
  match
    ( metadata.type_field,
      metadata.props_field,
      metadata.events_field,
      metadata.children_field,
      metadata.bind_prop,
      metadata.required_bind_value,
      metadata.scalar_fallback_field,
      metadata.scalar_fallback_kind,
      metadata.fallback_prop_kind )
  with
  | ( Some type_field,
      Some props_field,
      Some events_field,
      Some children_field,
      Some bind_prop,
      Some required_bind_value,
      Some scalar_fallback_field,
      Some scalar_fallback_kind,
      Some fallback_prop_kind ) ->
      Some
        {
          Eval_meta_protocol_component_model.prop_name_normalization =
            Option.value
              ~default:component_fields.component_prop_name_normalization
              metadata.prop_name_normalization;
          Eval_meta_protocol_component_model.type_field;
          props_field;
          events_field;
          children_field;
          bind_prop;
          required_bind_value;
          scalar_fallback_field;
          scalar_fallback_kind;
          fallback_prop_kind;
        }
  | _ -> None

let component_protocol_of_form
    (component_fields : Metadata.component_registry_fields)
    (slot_fields : Metadata.slot_registry_fields) (form : Descriptor.form) =
  Util.extension_spec_of_form
    ~extension_key:component_fields.component_protocol_extension
    (fun extension ->
      component_protocol_metadata_of_extension component_fields slot_fields
        extension
      |> component_protocol_of_metadata component_fields)
    form

let build_component_protocol_from_forms forms component_fields slot_fields =
  List.find_map (component_protocol_of_form component_fields slot_fields) forms

let parse_sigil_pair = function
  | VList [ sigil; source ] | VVector [ sigil; source ] -> (
      match (scalar_string sigil, key_string source) with
      | Some sigil, Some source -> Some (sigil, source)
      | _ -> None)
  | _ -> None

let parse_sigils = function
  | Some (VList sigils) | Some (VVector sigils) ->
      List.filter_map parse_sigil_pair sigils
  | _ -> []

let parse_expr_source_forms = function
  | Some (VList values) | Some (VVector values) ->
      List.filter_map key_string values
  | _ -> []

let expr_source_metadata_of_form (expr_fields : Metadata.expr_registry_fields)
    (form : Descriptor.form) =
  let forms =
    Util.extension_spec_of_form ~extension_key:expr_fields.enum_extension
      (fun extension ->
        match Util.option_value ":name" extension with
        | Some enum_name
          when key_string enum_name = Some expr_fields.expr_source_enum ->
            Some
              ( expr_fields.expr_source_enum,
                parse_expr_source_forms (Util.option_value ":values" extension)
              )
        | _ -> None)
      form
    |> Option.map snd |> Option.value ~default:[]
  in
  let sigils =
    Util.extension_spec_of_form ~extension_key:expr_fields.expr_source_extension
      (fun extension ->
        Some
          ( expr_fields.expr_source_enum,
            parse_sigils
              (extension_value expr_fields.expr_source_sigils_field extension)
          ))
      form
    |> Option.map snd |> Option.value ~default:[]
  in
  if forms = [] && sigils = [] then None
  else Some (expr_fields.expr_source_enum, { forms; sigils })

let build_expr_source_config_from_forms forms expr_fields =
  let specs = List.filter_map (expr_source_metadata_of_form expr_fields) forms in
  { Eval_meta_protocol_lowering.forms = List.find_map (fun (_,metadata) -> if metadata.forms=[] then None else Some metadata.forms) specs |> Option.value ~default:[];
    sigils = List.find_map (fun (_,metadata) -> if metadata.sigils=[] then None else Some metadata.sigils) specs |> Option.value ~default:[] }
