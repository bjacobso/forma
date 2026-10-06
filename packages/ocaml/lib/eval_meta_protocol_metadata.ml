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

type diagnostic = Eval_common.diagnostic = {
  span : Ast.span option;
  code : string;
  message : string;
}

module Util = Eval_meta_util
module Config = Eval_meta_protocol_registry_config

let scalar_string = Eval_slot.scalar_string
let key_string = Eval_meta_util.key_string
let diagnostic = Eval_common.diagnostic

let extension_value field_name extension =
  Util.option_value (":" ^ field_name) extension

let extension_key field_name extension =
  Option.bind (extension_value field_name extension) key_string

let extension_scalar_string field_name extension =
  Option.bind (extension_value field_name extension) scalar_string

include Eval_meta_protocol_metadata_types

let ( let* ) option_value_result f = Option.bind option_value_result f
let parse_name_normalization = Config.parse_name_normalization

let required_key field_value field_name =
  Option.bind (field_value field_name) key_string

let required_scalar_string field_value field_name =
  Option.bind (field_value field_name) scalar_string

let required_bool field_value field_name =
  Config.parse_bool (field_value field_name)

let required_name_normalization field_value field_name =
  Config.parse_name_normalization (required_key field_value field_name)

let required_slot_compile_mechanism_config field_value =
  match
    ( required_key field_value ":slot-json-mechanism",
      required_key field_value ":slot-value-mechanism",
      required_key field_value ":slot-expr-mechanism",
      required_key field_value ":slot-node-list-mechanism" )
  with
  | ( Some json_mechanism,
      Some value_mechanism,
      Some expr_mechanism,
      Some node_list_mechanism ) ->
      Some
        (Config.build_slot_compile_mechanism_config ~json_mechanism
           ~value_mechanism ~expr_mechanism ~node_list_mechanism)
  | _ -> None

let required_protocol_registry_header field_value =
  let* compile_layout_tree_op =
    required_key field_value ":compile-layout-tree-op"
  in
  let* hosted_dsl_name =
    required_scalar_string field_value ":hosted-dsl-name"
  in
  let* allow_default_component_layout_args =
    required_bool field_value ":allow-default-component-layout-args"
  in
  let* allow_hosted_dsl_name_layout_args =
    required_bool field_value ":allow-hosted-dsl-name-layout-args"
  in
  Some
    {
      compile_layout_tree_op;
      hosted_dsl_name;
      allow_default_component_layout_args;
      allow_hosted_dsl_name_layout_args;
    }

let required_component_registry_fields field_value =
  let* component_prop_name_normalization =
    required_name_normalization field_value ":component-prop-name-normalization"
  in
  let* component_extension = required_key field_value ":component-extension" in
  let* component_protocol_extension =
    required_key field_value ":component-protocol-extension"
  in
  let* component_protocol_prop_name_normalization_field =
    required_key field_value ":component-protocol-prop-name-normalization-field"
  in
  let* component_protocol_type_field_field =
    required_key field_value ":component-protocol-type-field-field"
  in
  let* component_protocol_props_field_field =
    required_key field_value ":component-protocol-props-field-field"
  in
  let* component_protocol_events_field_field =
    required_key field_value ":component-protocol-events-field-field"
  in
  let* component_protocol_children_field_field =
    required_key field_value ":component-protocol-children-field-field"
  in
  let* component_protocol_bind_prop_field_field =
    required_key field_value ":component-protocol-bind-prop-field-field"
  in
  let* component_protocol_required_bind_value_field_field =
    required_key field_value
      ":component-protocol-required-bind-value-field-field"
  in
  let* component_protocol_scalar_fallback_field_field =
    required_key field_value ":component-protocol-scalar-fallback-field-field"
  in
  let* component_protocol_scalar_fallback_kind_field_field =
    required_key field_value
      ":component-protocol-scalar-fallback-kind-field-field"
  in
  let* component_protocol_unknown_props_field =
    required_key field_value ":component-protocol-unknown-props-field"
  in
  let* component_compile_field =
    required_key field_value ":component-compile-field"
  in
  let* component_children_policy_field =
    required_key field_value ":component-children-policy-field"
  in
  let* component_parents_field =
    required_key field_value ":component-parents-field"
  in
  let* component_allows_bind_field =
    required_key field_value ":component-allows-bind-field"
  in
  let* component_json_slots_field =
    required_key field_value ":component-json-slots-field"
  in
  let* component_node_slots_field =
    required_key field_value ":component-node-slots-field"
  in
  let* component_expr_props_field =
    required_key field_value ":component-expr-props-field"
  in
  let* component_unknown_props_field =
    required_key field_value ":component-unknown-props-field"
  in
  let* component_required_children_field =
    required_key field_value ":component-required-children-field"
  in
  let* component_required_bind_field =
    required_key field_value ":component-required-bind-field"
  in
  let* component_field_overrides_field =
    required_key field_value ":component-field-overrides-field"
  in
  let* component_event_overrides_field =
    required_key field_value ":component-event-overrides-field"
  in
  let* component_positional_prop_field =
    required_key field_value ":component-positional-prop-field"
  in
  let* component_events_field =
    required_key field_value ":component-events-field"
  in
  let* component_type_field_field =
    required_key field_value ":component-type-field-field"
  in
  let* component_events_section_field =
    required_key field_value ":component-events-section-field"
  in
  let* component_props_section_field =
    required_key field_value ":component-props-section-field"
  in
  let* component_children_section_field =
    required_key field_value ":component-children-section-field"
  in
  Some
    {
      component_prop_name_normalization;
      component_extension;
      component_protocol_extension;
      component_protocol_prop_name_normalization_field;
      component_protocol_type_field_field;
      component_protocol_props_field_field;
      component_protocol_events_field_field;
      component_protocol_children_field_field;
      component_protocol_bind_prop_field_field;
      component_protocol_required_bind_value_field_field;
      component_protocol_scalar_fallback_field_field;
      component_protocol_scalar_fallback_kind_field_field;
      component_protocol_unknown_props_field;
      component_compile_field;
      component_children_policy_field;
      component_parents_field;
      component_allows_bind_field;
      component_json_slots_field;
      component_node_slots_field;
      component_expr_props_field;
      component_unknown_props_field;
      component_required_children_field;
      component_required_bind_field;
      component_field_overrides_field;
      component_event_overrides_field;
      component_positional_prop_field;
      component_events_field;
      component_type_field_field;
      component_events_section_field;
      component_props_section_field;
      component_children_section_field;
    }

let required_action_registry_fields field_value =
  let* action_form_field = required_key field_value ":action-form-field" in
  let* action_discriminator_field_field =
    required_key field_value ":action-discriminator-field-field"
  in
  let* action_tag_field = required_key field_value ":action-tag-field" in
  let* action_callbacks_field =
    required_key field_value ":action-callbacks-field"
  in
  let* action_positional_field =
    required_key field_value ":action-positional-field"
  in
  let* action_keywords_field =
    required_key field_value ":action-keywords-field"
  in
  let* action_extension = required_key field_value ":action-extension" in
  let* action_string_mechanism =
    required_key field_value ":action-string-mechanism"
  in
  let* action_expr_mechanism =
    required_key field_value ":action-expr-mechanism"
  in
  let* action_json_mechanism =
    required_key field_value ":action-json-mechanism"
  in
  let* action_literal_mechanism =
    required_key field_value ":action-literal-mechanism"
  in
  let* action_string_list_mechanism =
    required_key field_value ":action-string-list-mechanism"
  in
  Some
    {
      action_form_field;
      action_discriminator_field_field;
      action_tag_field;
      action_callbacks_field;
      action_positional_field;
      action_keywords_field;
      action_extension;
      action_mechanism_config =
        Config.build_action_mechanism_config action_string_mechanism
          action_expr_mechanism action_json_mechanism action_literal_mechanism
          action_string_list_mechanism;
      action_field_kinds =
        Config.parse_string_record (field_value ":action-field-kinds");
    }

let required_expr_registry_fields field_value =
  let* enum_extension = required_key field_value ":enum-extension" in
  let* expr_op_form_field = required_key field_value ":expr-op-form-field" in
  let* expr_op_lowering_field =
    required_key field_value ":expr-op-lowering-field"
  in
  let* expr_op_name_field = required_key field_value ":expr-op-name-field" in
  let* expr_op_operator_field =
    required_key field_value ":expr-op-operator-field"
  in
  let* expr_op_extension = required_key field_value ":expr-op-extension" in
  let* expr_get_path_mechanism =
    required_key field_value ":expr-get-path-mechanism"
  in
  let* expr_pipe_call_mechanism =
    required_key field_value ":expr-pipe-call-mechanism"
  in
  let* expr_unary_mechanism =
    required_key field_value ":expr-unary-mechanism"
  in
  let* expr_binary_mechanism =
    required_key field_value ":expr-binary-mechanism"
  in
  let* expr_compare_nil_mechanism =
    required_key field_value ":expr-compare-nil-mechanism"
  in
  let* expr_conditional_mechanism =
    required_key field_value ":expr-conditional-mechanism"
  in
  let* expr_pipe_chain_mechanism =
    required_key field_value ":expr-pipe-chain-mechanism"
  in
  let* expr_literal_object_default_key =
    required_key field_value ":expr-literal-object-default-key"
  in
  let* expr_json_object_default_key =
    required_key field_value ":expr-json-object-default-key"
  in
  let* expr_var_default_source =
    required_scalar_string field_value ":expr-var-default-source"
  in
  let* expr_kind_field = required_key field_value ":expr-kind-field" in
  let* expr_literal_kind = required_key field_value ":expr-literal-kind" in
  let* expr_literal_value_field =
    required_key field_value ":expr-literal-value-field"
  in
  let* expr_var_kind = required_key field_value ":expr-var-kind" in
  let* expr_var_source_field =
    required_key field_value ":expr-var-source-field"
  in
  let* expr_var_path_field = required_key field_value ":expr-var-path-field" in
  let* expr_unary_kind = required_key field_value ":expr-unary-kind" in
  let* expr_unary_op_field = required_key field_value ":expr-unary-op-field" in
  let* expr_unary_value_field =
    required_key field_value ":expr-unary-value-field"
  in
  let* expr_binary_kind = required_key field_value ":expr-binary-kind" in
  let* expr_binary_op_field =
    required_key field_value ":expr-binary-op-field"
  in
  let* expr_binary_left_field =
    required_key field_value ":expr-binary-left-field"
  in
  let* expr_binary_right_field =
    required_key field_value ":expr-binary-right-field"
  in
  let* expr_conditional_kind =
    required_key field_value ":expr-conditional-kind"
  in
  let* expr_conditional_condition_field =
    required_key field_value ":expr-conditional-condition-field"
  in
  let* expr_conditional_then_field =
    required_key field_value ":expr-conditional-then-field"
  in
  let* expr_conditional_else_field =
    required_key field_value ":expr-conditional-else-field"
  in
  let* expr_pipe_kind = required_key field_value ":expr-pipe-kind" in
  let* expr_pipe_name_field =
    required_key field_value ":expr-pipe-name-field"
  in
  let* expr_pipe_value_field =
    required_key field_value ":expr-pipe-value-field"
  in
  let* expr_pipe_args_field =
    required_key field_value ":expr-pipe-args-field"
  in
  let* expr_compare_nil_operator =
    required_scalar_string field_value ":expr-compare-nil-operator"
  in
  let* expr_source_extension =
    required_key field_value ":expr-source-extension"
  in
  let* expr_source_sigils_field =
    required_key field_value ":expr-source-sigils-field"
  in
  let* expr_source_enum = required_key field_value ":expr-source-enum" in
  Some
    {
      enum_extension;
      expr_op_form_field;
      expr_op_lowering_field;
      expr_op_name_field;
      expr_op_operator_field;
      expr_op_extension;
      expr_source_extension;
      expr_source_sigils_field;
      expr_source_enum;
      expr_mechanism_config =
        Config.build_expr_mechanism_config expr_get_path_mechanism
          expr_pipe_call_mechanism expr_unary_mechanism expr_binary_mechanism
          expr_compare_nil_mechanism expr_conditional_mechanism
          expr_pipe_chain_mechanism expr_literal_object_default_key
          expr_json_object_default_key expr_var_default_source;
      expr_shape_config =
        Config.build_expr_shape_config expr_kind_field expr_literal_kind
          expr_literal_value_field expr_var_kind expr_var_source_field
          expr_var_path_field expr_unary_kind expr_unary_op_field
          expr_unary_value_field expr_binary_kind expr_binary_op_field
          expr_binary_left_field expr_binary_right_field expr_conditional_kind
          expr_conditional_condition_field expr_conditional_then_field
          expr_conditional_else_field expr_pipe_kind expr_pipe_name_field
          expr_pipe_value_field expr_pipe_args_field expr_compare_nil_operator;
      expr_op_lowerings =
        Config.parse_string_record (field_value ":expr-op-lowerings");
    }

let required_layout_alias_registry_fields field_value =
  let* layout_alias_form_field =
    required_key field_value ":layout-alias-form-field"
  in
  let* layout_alias_to_field =
    required_key field_value ":layout-alias-to-field"
  in
  let* layout_alias_component_name_field =
    required_key field_value ":layout-alias-component-name-field"
  in
  let* layout_alias_component_name_prop_field =
    required_key field_value ":layout-alias-component-name-prop-field"
  in
  let* layout_alias_extension =
    required_key field_value ":layout-alias-extension"
  in
  let* layout_alias_default_to =
    required_scalar_string field_value ":layout-alias-default-to"
  in
  Some
    {
      layout_alias_form_field;
      layout_alias_to_field;
      layout_alias_component_name_field;
      layout_alias_component_name_prop_field;
      layout_alias_extension;
      layout_alias_default_to;
    }

let required_slot_registry_fields field_value slot_compile_kinds =
  let* slot_compile_mechanism_config =
    required_slot_compile_mechanism_config field_value
  in
  let* default_form_slot_kind =
    Config.parse_slot_compile_kind slot_compile_mechanism_config
      slot_compile_kinds
      (required_key field_value ":default-form-slot-kind")
  in
  let* default_value_slot_kind =
    Config.parse_slot_compile_kind slot_compile_mechanism_config
      slot_compile_kinds
      (required_key field_value ":default-value-slot-kind")
  in
  let* default_expr_slot_kind =
    Config.parse_slot_compile_kind slot_compile_mechanism_config
      slot_compile_kinds
      (required_key field_value ":default-expr-slot-kind")
  in
  Some
    {
      slot_compile_mechanism_config;
      slot_compile_kinds;
      default_form_slot_kind;
      default_value_slot_kind;
      default_expr_slot_kind;
    }

let assemble_protocol_registry (header : protocol_registry_header)
    (component_fields : component_registry_fields)
    (action_fields : action_registry_fields)
    (expr_fields : expr_registry_fields)
    (layout_alias_fields : layout_alias_registry_fields)
    (slot_fields : slot_registry_fields) =
  {
    header;
    component_fields;
    action_fields;
    expr_fields;
    layout_alias_fields;
    slot_fields;
  }

let protocol_registry_of_extension extension =
  let field_value field_name = Util.option_value field_name extension in
  let slot_compile_kinds =
    Config.parse_string_record (field_value ":slot-compile-kinds")
  in
  let* header = required_protocol_registry_header field_value in
  let* component_fields = required_component_registry_fields field_value in
  let* action_fields = required_action_registry_fields field_value in
  let* expr_fields = required_expr_registry_fields field_value in
  let* layout_alias_fields =
    required_layout_alias_registry_fields field_value
  in
  let* slot_fields =
    required_slot_registry_fields field_value slot_compile_kinds
  in
  Some
    (assemble_protocol_registry header component_fields action_fields
       expr_fields layout_alias_fields slot_fields)

let protocol_registry_of_form (form : Descriptor.form) =
  Util.extension_spec_of_form ~extension_key:"protocol/registry"
    protocol_registry_of_extension form

let protocol_registries env =
  Descriptor.forms env |> List.filter_map protocol_registry_of_form

let build_protocol_registry env component_extension =
  protocol_registries env
  |> List.find_opt (fun registry ->
      registry.component_fields.component_extension = component_extension)

let build_protocol_registry_for_op env op =
  protocol_registries env
  |> List.find_opt (fun registry -> registry.header.compile_layout_tree_op = op)
