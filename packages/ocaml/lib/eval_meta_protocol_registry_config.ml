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

let scalar_string = Eval_slot.scalar_string
let key_string = Eval_meta_util.key_string

let parse_string_record = function
  | Some (VMap entries) ->
      entries
      |> List.filter_map (fun (key, value) ->
          match (key_string key, key_string value) with
          | Some key, Some value -> Some (key, value)
          | _ -> None)
  | _ -> []

let parse_bool = function Some (VBool value) -> Some value | _ -> None

let build_slot_compile_mechanism_config ~json_mechanism ~value_mechanism
    ~expr_mechanism ~node_list_mechanism =
  {
    Eval_meta_protocol_component_model.json_mechanism;
    value_mechanism;
    expr_mechanism;
    node_list_mechanism;
  }

let parse_slot_compile_kind slot_compile_mechanism_config registry_entries =
  function
  | Some kind_name -> (
      match List.assoc_opt kind_name registry_entries with
      | Some mechanism ->
          Eval_meta_protocol_component_model.slot_compile_kind_of_mechanism
            slot_compile_mechanism_config mechanism
      | None -> None)
  | None -> None

let parse_name_normalization = function
  | Some mechanism ->
      Eval_meta_protocol_component_model.name_normalization_of_mechanism
        mechanism
  | None -> None

let build_action_mechanism_config action_string_mechanism action_expr_mechanism
    action_json_mechanism action_literal_mechanism action_string_list_mechanism
    =
  {
    Eval_meta_protocol_lowering.string_mechanism = action_string_mechanism;
    expr_mechanism = action_expr_mechanism;
    json_mechanism = action_json_mechanism;
    literal_mechanism = action_literal_mechanism;
    string_list_mechanism = action_string_list_mechanism;
  }

let build_expr_shape_config expr_kind_field expr_literal_kind
    expr_literal_value_field expr_var_kind expr_var_source_field
    expr_var_path_field expr_unary_kind expr_unary_op_field
    expr_unary_value_field expr_binary_kind expr_binary_op_field
    expr_binary_left_field expr_binary_right_field expr_conditional_kind
    expr_conditional_condition_field expr_conditional_then_field
    expr_conditional_else_field expr_pipe_kind expr_pipe_name_field
    expr_pipe_value_field expr_pipe_args_field expr_compare_nil_operator =
  {
    Eval_meta_protocol_lowering.kind_field = expr_kind_field;
    literal_kind = expr_literal_kind;
    literal_value_field = expr_literal_value_field;
    var_kind = expr_var_kind;
    var_source_field = expr_var_source_field;
    var_path_field = expr_var_path_field;
    unary_kind = expr_unary_kind;
    unary_op_field = expr_unary_op_field;
    unary_value_field = expr_unary_value_field;
    binary_kind = expr_binary_kind;
    binary_op_field = expr_binary_op_field;
    binary_left_field = expr_binary_left_field;
    binary_right_field = expr_binary_right_field;
    conditional_kind = expr_conditional_kind;
    conditional_condition_field = expr_conditional_condition_field;
    conditional_then_field = expr_conditional_then_field;
    conditional_else_field = expr_conditional_else_field;
    pipe_kind = expr_pipe_kind;
    pipe_name_field = expr_pipe_name_field;
    pipe_value_field = expr_pipe_value_field;
    pipe_args_field = expr_pipe_args_field;
    compare_nil_operator = expr_compare_nil_operator;
  }

let build_expr_mechanism_config expr_get_path_mechanism expr_pipe_call_mechanism
    expr_unary_mechanism expr_binary_mechanism expr_compare_nil_mechanism
    expr_conditional_mechanism expr_pipe_chain_mechanism
    expr_literal_object_default_key expr_json_object_default_key
    expr_var_default_source =
  {
    Eval_meta_protocol_lowering.get_path_mechanism = expr_get_path_mechanism;
    pipe_call_mechanism = expr_pipe_call_mechanism;
    unary_mechanism = expr_unary_mechanism;
    binary_mechanism = expr_binary_mechanism;
    compare_nil_mechanism = expr_compare_nil_mechanism;
    conditional_mechanism = expr_conditional_mechanism;
    pipe_chain_mechanism = expr_pipe_chain_mechanism;
    literal_object_default_key = expr_literal_object_default_key;
    json_object_default_key = expr_json_object_default_key;
    var_default_source = expr_var_default_source;
  }
