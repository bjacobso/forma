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

type slot_compile_spec =
      Eval_meta_protocol_component_model.slot_compile_spec = {
  field : string;
  kind : slot_compile_kind;
}

type component_spec = Eval_meta_protocol_component_model.component_spec
type component_protocol = Eval_meta_protocol_component_model.component_protocol

type node_shape = Eval_meta_protocol_component_model.node_shape = {
  type_field_key : string;
  props_section_key : string;
  events_section_key : string;
  children_section_key : string;
  scalar_fallback_slot : slot_compile_spec;
  required_bind_slot : slot_compile_spec option;
  required_bind_value : value option;
}

type resolved_component =
      Eval_meta_protocol_component_model.resolved_component = {
  component_type : string;
  spec : component_spec option;
  shape : node_shape;
  positional_slot : slot_compile_spec option;
  scalar_slots : slot_compile_spec list;
  requires_children : bool;
}

type component_registry =
      Eval_meta_protocol_component_model.component_registry = {
  protocol : component_protocol;
  specs : (string * component_spec) list;
}

type component_item = Eval_meta_protocol_component_model.component_item =
  | Scalar_item of value
  | Prop_entries_item of (string * value) list
  | Child_item of value
  | Ignored_item

type node_compile_ops_factory =
  Eval_meta_protocol_lowering.node_compile_ops_factory

type tree_compile_context = {
  registry : component_registry;
  node_ops : node_compile_ops_factory;
}

type node_assembly = {
  component : resolved_component;
  mutable node_entries : (value * value) list;
  mutable prop_entries : (value * value) list;
  mutable event_entries : (value * value) list;
  mutable child_entries : value list;
}

type compiled_node = { component_type : string; value : value }

type node_compile_ops = Eval_meta_protocol_lowering.node_compile_ops = {
  compile_expr_value : value -> value;
  compile_event_value : value -> value;
  compile_slot_value : slot_compile_spec -> value -> value;
  compile_required_value : value -> value;
}

type node_compile_context = {
  registry : component_registry;
  ops : node_compile_ops;
  compile_node : value -> compiled_node option;
}

let field key value = (Value.VKeyword (":" ^ key), value)

module Model = Eval_meta_protocol_component_model

let create_node_assembly component =
  {
    component;
    node_entries = Model.initial_node_entries component;
    prop_entries = [];
    event_entries = [];
    child_entries = [];
  }

let prepend_entry field_name value entries = field field_name value :: entries

let add_node_entry assembly field_name value =
  assembly.node_entries <- prepend_entry field_name value assembly.node_entries

let add_prop_entry assembly field_name value =
  assembly.prop_entries <- prepend_entry field_name value assembly.prop_entries

let add_event_entry assembly field_name value =
  assembly.event_entries <-
    prepend_entry field_name value assembly.event_entries

let add_child_entry assembly value =
  assembly.child_entries <- value :: assembly.child_entries

let allows_child assembly child =
  Model.allows_child_for_component assembly.component child.component_type

let route_prop compile_node_value assembly raw_key value =
  match
    Model.resolve_prop_for_component compile_node_value.registry
      assembly.component raw_key
  with
  | Model.Event_field event_field ->
      add_event_entry assembly event_field
        (compile_node_value.ops.compile_event_value value)
  | Model.Slot slot -> (
      match compile_node_value.ops.compile_slot_value slot value with
      | VNil -> ()
      | slot_value -> add_node_entry assembly slot.field slot_value)
  | Model.Expr_prop expr_key ->
      add_node_entry assembly expr_key
        (compile_node_value.ops.compile_expr_value value)
  | Model.Fallback_prop fallback_slot -> (
      match compile_node_value.ops.compile_slot_value fallback_slot value with
      | VNil -> ()
      | fallback_value ->
          add_prop_entry assembly fallback_slot.field fallback_value)

let route_scalar_item compile_node_value assembly value =
  let rec loop = function
    | [] -> ()
    | slot :: rest -> (
        match compile_node_value.ops.compile_slot_value slot value with
        | VNil -> loop rest
        | slot_value -> add_node_entry assembly slot.field slot_value)
  in
  loop (Model.scalar_slots_for_component assembly.component)

let route_child compile_node_value assembly value =
  match compile_node_value.compile_node value with
  | Some child when allows_child assembly child ->
      add_child_entry assembly child.value
  | Some _ -> ()
  | None -> ()

let process_component_item compile_node_value assembly item =
  match item with
  | Scalar_item item -> route_scalar_item compile_node_value assembly item
  | Prop_entries_item entries ->
      List.iter
        (fun (key, value) -> route_prop compile_node_value assembly key value)
        entries
  | Child_item item -> route_child compile_node_value assembly item
  | Ignored_item -> ()

let process_component_items compile_node_value assembly items =
  List.iter
    (process_component_item compile_node_value assembly)
    (Model.classify_component_items items)

let children_satisfied (assembly : node_assembly) =
  Model.child_entries_satisfy assembly.component assembly.child_entries

let compiled_node_of_entries (component : resolved_component) entries :
    compiled_node =
  {
    component_type = Model.component_type_of_resolved component;
    value = Model.compiled_node_value entries;
  }

let assembled_node_entries compile_required_value (assembly : node_assembly) =
  Model.finalized_node_entries compile_required_value assembly.component
    ~node_entries:assembly.node_entries ~prop_entries:assembly.prop_entries
    ~event_entries:assembly.event_entries ~child_entries:assembly.child_entries

let finalize_node compile_node_value (assembly : node_assembly) =
  if not (children_satisfied assembly) then None
  else
    Some
      (compiled_node_of_entries assembly.component
         (assembled_node_entries compile_node_value.ops.compile_required_value
            assembly))

let node_compile_context_of_component (registry : component_registry)
    (node_ops : node_compile_ops_factory) (component : resolved_component)
    (compile_node_fn : string option -> value -> compiled_node option) :
    node_compile_context =
  let compile_node =
    compile_node_fn (Some (Model.component_type_of_resolved component))
  in
  let compile_child_value value =
    Option.map (fun node -> node.value) (compile_node value)
  in
  { registry; ops = node_ops compile_child_value; compile_node }

let compile_component_node compile_node_value component items =
  let assembly = create_node_assembly component in
  process_component_items compile_node_value assembly items;
  finalize_node compile_node_value assembly

let compile_layout_tree (context : tree_compile_context) layout =
  let registry = context.registry in
  let node_ops = context.node_ops in
  let rec compile_node parent_type expr =
    match expr with
    | VList (head :: items) -> (
        match Model.resolve_component_head registry parent_type head with
        | Some component ->
            let compile_node_value =
              node_compile_context_of_component registry node_ops component
                compile_node
            in
            compile_component_node compile_node_value component items
        | _ -> None)
    | _ -> None
  in
  Option.map (fun node -> node.value) (compile_node None layout)
