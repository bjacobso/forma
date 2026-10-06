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

type action_field_kind = Eval_meta_protocol_action_lowering.action_field_kind =
  | ActionString
  | ActionExpr
  | ActionJson
  | ActionLiteral
  | ActionStringList

type action_mechanism_config =
      Eval_meta_protocol_action_lowering.action_mechanism_config = {
  string_mechanism : string;
  expr_mechanism : string;
  json_mechanism : string;
  literal_mechanism : string;
  string_list_mechanism : string;
}

type action_field_spec =
      Eval_meta_protocol_action_lowering.action_field_spec = {
  input_name : string;
  field : string;
  kind : action_field_kind;
  optional : bool;
}

type action_callback_spec =
      Eval_meta_protocol_action_lowering.action_callback_spec = {
  input_name : string;
  field : string;
}

type action_spec = Eval_meta_protocol_action_lowering.action_spec = {
  discriminator_field : string;
  tag : string;
  callbacks : action_callback_spec list;
  positional : action_field_spec list;
  keywords : action_field_spec list;
}

type alias_target = { to_name : string; component_name : string option }

type expr_source_config = Eval_meta_protocol_expr_lowering.source_config = {
  forms : string list;
  sigils : (string * string) list;
}

type expr_mechanism_config =
      Eval_meta_protocol_expr_lowering.mechanism_config = {
  get_path_mechanism : string;
  pipe_call_mechanism : string;
  unary_mechanism : string;
  binary_mechanism : string;
  compare_nil_mechanism : string;
  conditional_mechanism : string;
  pipe_chain_mechanism : string;
  literal_object_default_key : string;
  json_object_default_key : string;
  var_default_source : string;
}

type expr_shape_config = Eval_meta_protocol_expr_lowering.shape_config = {
  kind_field : string;
  literal_kind : string;
  literal_value_field : string;
  var_kind : string;
  var_source_field : string;
  var_path_field : string;
  unary_kind : string;
  unary_op_field : string;
  unary_value_field : string;
  binary_kind : string;
  binary_op_field : string;
  binary_left_field : string;
  binary_right_field : string;
  conditional_kind : string;
  conditional_condition_field : string;
  conditional_then_field : string;
  conditional_else_field : string;
  pipe_kind : string;
  pipe_name_field : string;
  pipe_value_field : string;
  pipe_args_field : string;
  compare_nil_operator : string;
}

type expr_op_spec = Eval_meta_protocol_expr_lowering.op_spec =
  | ExprGetPath
  | ExprPipeCall of string
  | ExprUnary of string
  | ExprBinary of string
  | ExprCompareNil
  | ExprConditional
  | ExprPipeChain

type layout_alias_context = {
  component_name_prop_field : string;
  aliases : (string * alias_target) list;
}

type expr_compile_context = Eval_meta_protocol_expr_lowering.compile_context = {
  source_config : expr_source_config;
  mechanism_config : expr_mechanism_config;
  shape_config : expr_shape_config;
  op_config : (string * expr_op_spec) list;
}

type lowering_context = {
  expr : expr_compile_context;
  action_specs : (string * action_spec) list;
}

type slot_compile_kind = Eval_meta_protocol_component_model.slot_compile_kind =
  | Expr
  | Json
  | NodeList
  | Value

type slot_compile_spec =
      Eval_meta_protocol_component_model.slot_compile_spec = {
  field : string;
  kind : slot_compile_kind;
}

type node_compile_ops = {
  compile_expr_value : Value.t -> Value.t;
  compile_event_value : Value.t -> Value.t;
  compile_slot_value : slot_compile_spec -> Value.t -> Value.t;
  compile_required_value : Value.t -> Value.t;
}

type node_compile_ops_factory = (Value.t -> Value.t option) -> node_compile_ops

let action_field_kind_of_mechanism =
  Eval_meta_protocol_action_lowering.action_field_kind_of_mechanism

let expr_op_spec_of_mechanism =
  Eval_meta_protocol_expr_lowering.op_spec_of_mechanism

let with_lowering_context context fn =
  Eval_meta_protocol_expr_lowering.with_context context.expr fn

let rewrite_layout_aliases_with_context context value =
  let aliases =
    List.map
      (fun (name, target) ->
        {
          Eval_meta_protocol_layout_alias.name;
          to_name = target.to_name;
          component_name = target.component_name;
        })
      context.aliases
  in
  Eval_meta_protocol_layout_alias.rewrite
    ~component_name_prop_field:context.component_name_prop_field aliases value

let literal_expr_with_context context value =
  with_lowering_context context (fun () ->
      Eval_meta_protocol_expr_lowering.literal_expr value)

let normalize_literal_value_with_context context value =
  with_lowering_context context (fun () ->
      Eval_meta_protocol_expr_lowering.normalize_literal_value value)

let compile_expr_with_context context value =
  with_lowering_context context (fun () ->
      Eval_meta_protocol_expr_lowering.compile_expr value)

let compile_json_value_with_context context value =
  with_lowering_context context (fun () ->
      Eval_meta_protocol_expr_lowering.compile_json_value value)

let compile_slot_value_with_context lowering compile_node_value slot value =
  match slot.kind with
  | Json -> compile_json_value_with_context lowering value
  | Value -> normalize_literal_value_with_context lowering value
  | Expr -> compile_expr_with_context lowering value
  | NodeList -> (
      match value with
      | VVector values -> VList (List.filter_map compile_node_value values)
      | value -> (
          match compile_node_value value with
          | Some node -> VList [ node ]
          | None -> VNil))

let event_value_with_context context value =
  with_lowering_context context (fun () ->
      Eval_meta_protocol_action_lowering.event_value
        {
          compile_expr = Eval_meta_protocol_expr_lowering.compile_expr;
          compile_json_value =
            Eval_meta_protocol_expr_lowering.compile_json_value;
          normalize_literal_value =
            Eval_meta_protocol_expr_lowering.normalize_literal_value;
        }
        context.action_specs value)

let node_compile_ops_with_context lowering compile_child_value :
    node_compile_ops =
  {
    compile_expr_value = compile_expr_with_context lowering;
    compile_event_value = event_value_with_context lowering;
    compile_slot_value =
      compile_slot_value_with_context lowering compile_child_value;
    compile_required_value = literal_expr_with_context lowering;
  }

let node_compile_ops_factory_with_context lowering : node_compile_ops_factory =
 fun compile_child_value ->
  node_compile_ops_with_context lowering compile_child_value
