[@@@warning "-69"]

type diagnostic = { path : string; message : string }
type trigger = { trigger_kind : string; entity : string option }

type node_input = {
  name : string;
  expr : Ir_json.t option;
  type_ : Ir_json.t option;
}

type node = {
  id : string;
  action : string option;
  mutation : string option;
  join : string option;
  fan_out : string option;
  inputs : node_input list option;
}

type edge = { from_ : string; to_ : string; guard : Ir_json.t option }

type flow = {
  name : string;
  description : string option;
  trigger : trigger;
  nodes : node list;
  edges : edge list;
  loc : Ir_json.t option;
}

type work_input = {
  name : string;
  type_ : Ir_json.t option;
  required : bool option;
}

type work_item = {
  name : string;
  title : string;
  description : string option;
  inputs : work_input list;
  loc : Ir_json.t option;
}

type t = Flow_payload of flow | Work_item_payload of work_item

let diagnostic path message = { path; message }
let diagnostic_path (diagnostic : diagnostic) = diagnostic.path
let diagnostic_message (diagnostic : diagnostic) = diagnostic.message

let json_kind = function
  | Ir_json.Null -> "null"
  | Bool _ -> "bool"
  | Int _ -> "int"
  | Float _ -> "float"
  | String _ -> "string"
  | Array _ -> "array"
  | Object _ -> "object"
  | Map _ -> "map"

let field_path field = Printf.sprintf "$.%s" field

let required_string_field label field declaration =
  match Canonical_ir_decl.payload_field field declaration with
  | Some (Ir_json.String value) -> Ok value
  | Some value ->
      Error
        [
          diagnostic (field_path field)
            (Printf.sprintf "%s payload field %s must be a string, got %s."
               label field (json_kind value));
        ]
  | None ->
      Error
        [
          diagnostic (field_path field)
            (Printf.sprintf "%s payload must include a textual %s field." label
               field);
        ]

let optional_string_field label field declaration =
  match Canonical_ir_decl.payload_field field declaration with
  | None | Some Ir_json.Null -> Ok None
  | Some (Ir_json.String value) -> Ok (Some value)
  | Some value ->
      Error
        [
          diagnostic (field_path field)
            (Printf.sprintf "%s payload field %s must be a string, got %s."
               label field (json_kind value));
        ]

let optional_object_field label field declaration =
  match Canonical_ir_decl.payload_field field declaration with
  | None | Some Ir_json.Null -> Ok None
  | Some (Ir_json.Object _ as value) -> Ok (Some value)
  | Some value ->
      Error
        [
          diagnostic (field_path field)
            (Printf.sprintf "%s payload field %s must be an object, got %s."
               label field (json_kind value));
        ]

let entry_string path label name entries =
  match List.assoc_opt name entries with
  | Some (Ir_json.String value) when value <> "" -> Ok value
  | Some (Ir_json.String _) ->
      Error
        [
          diagnostic path (Printf.sprintf "%s %s must not be empty." label name);
        ]
  | Some value ->
      Error
        [
          diagnostic path
            (Printf.sprintf "%s %s must be a string, got %s." label name
               (json_kind value));
        ]
  | None ->
      Error
        [ diagnostic path (Printf.sprintf "%s must include %s." label name) ]

let optional_entry_string path label name entries =
  match List.assoc_opt name entries with
  | None | Some Ir_json.Null -> Ok None
  | Some (Ir_json.String value) -> Ok (Some value)
  | Some value ->
      Error
        [
          diagnostic path
            (Printf.sprintf "%s %s must be a string, got %s." label name
               (json_kind value));
        ]

let optional_entry name entries =
  match List.assoc_opt name entries with
  | None | Some Ir_json.Null -> None
  | Some value -> Some value

let diagnostics_of_result = function
  | Ok _ -> []
  | Error diagnostics -> diagnostics

let trigger_of_json = function
  | Ir_json.Object entries -> (
      let trigger_kind =
        entry_string "$.trigger.triggerKind" "Workflow trigger" "triggerKind"
          entries
      in
      let entity =
        optional_entry_string "$.trigger.entity" "Workflow trigger" "entity"
          entries
      in
      match (trigger_kind, entity) with
      | Ok trigger_kind, Ok entity -> Ok { trigger_kind; entity }
      | trigger_kind, entity ->
          Error
            (diagnostics_of_result trigger_kind @ diagnostics_of_result entity))
  | value ->
      Error
        [
          diagnostic "$.trigger"
            (Printf.sprintf
               "Workflow payload trigger must be an object, got %s."
               (json_kind value));
        ]

let required_trigger declaration =
  match Canonical_ir_decl.payload_field "trigger" declaration with
  | Some value -> trigger_of_json value
  | None ->
      Error [ diagnostic "$.trigger" "Workflow payload must include trigger." ]

let node_input_of_json index = function
  | Ir_json.Object entries -> (
      let name =
        entry_string
          (Printf.sprintf "$.nodes[].inputs[%d].name" index)
          "Workflow node input" "name" entries
      in
      match name with
      | Ok name ->
          Ok
            {
              name;
              expr = optional_entry "expr" entries;
              type_ = optional_entry "type" entries;
            }
      | Error _ as error -> error)
  | value ->
      Error
        [
          diagnostic
            (Printf.sprintf "$.nodes[].inputs[%d]" index)
            (Printf.sprintf
               "Workflow node inputs entries must be objects, got %s."
               (json_kind value));
        ]

let array_items path label parse = function
  | Ir_json.Array values ->
      let rec loop acc diagnostics index = function
        | [] ->
            if diagnostics = [] then Ok (List.rev acc) else Error diagnostics
        | value :: rest -> (
            match parse index value with
            | Ok item -> loop (item :: acc) diagnostics (index + 1) rest
            | Error item_diagnostics ->
                loop acc (diagnostics @ item_diagnostics) (index + 1) rest)
      in
      loop [] [] 0 values
  | value ->
      Error
        [
          diagnostic path
            (Printf.sprintf "%s must be an array, got %s." label
               (json_kind value));
        ]

let node_inputs entries =
  match List.assoc_opt "inputs" entries with
  | None | Some Ir_json.Null -> Ok None
  | Some value ->
      array_items "$.nodes[].inputs" "Workflow node inputs" node_input_of_json
        value
      |> Result.map (fun inputs -> Some inputs)

let node_of_json index = function
  | Ir_json.Object entries -> (
      let id =
        entry_string
          (Printf.sprintf "$.nodes[%d].id" index)
          "Workflow node" "id" entries
      in
      let action =
        optional_entry_string
          (Printf.sprintf "$.nodes[%d].action" index)
          "Workflow node" "action" entries
      in
      let mutation =
        optional_entry_string
          (Printf.sprintf "$.nodes[%d].mutation" index)
          "Workflow node" "mutation" entries
      in
      let inputs = node_inputs entries in
      match (id, action, mutation, inputs) with
      | Ok id, Ok action, Ok mutation, Ok inputs ->
          Ok { id; action; mutation; join = None; fan_out = None; inputs }
      | id, action, mutation, inputs ->
          Error
            (diagnostics_of_result id
            @ diagnostics_of_result action
            @ diagnostics_of_result mutation
            @ diagnostics_of_result inputs))
  | value ->
      Error
        [
          diagnostic
            (Printf.sprintf "$.nodes[%d]" index)
            (Printf.sprintf "Workflow nodes entries must be objects, got %s."
               (json_kind value));
        ]

let edge_of_json index = function
  | Ir_json.Object entries -> (
      let from_ =
        entry_string
          (Printf.sprintf "$.edges[%d].from" index)
          "Workflow edge" "from" entries
      in
      let to_ =
        entry_string
          (Printf.sprintf "$.edges[%d].to" index)
          "Workflow edge" "to" entries
      in
      match (from_, to_) with
      | Ok from_, Ok to_ ->
          Ok { from_; to_; guard = optional_entry "guard" entries }
      | from_, to_ ->
          Error (diagnostics_of_result from_ @ diagnostics_of_result to_))
  | value ->
      Error
        [
          diagnostic
            (Printf.sprintf "$.edges[%d]" index)
            (Printf.sprintf "Workflow edges entries must be objects, got %s."
               (json_kind value));
        ]

let required_array field label parse declaration =
  match Canonical_ir_decl.payload_field field declaration with
  | Some value -> array_items (field_path field) label parse value
  | None ->
      Error
        [
          diagnostic (field_path field)
            (Printf.sprintf "Workflow payload must include %s." field);
        ]

let flow_of_declaration declaration =
  match
    ( required_string_field "Workflow" "name" declaration,
      optional_string_field "Workflow" "description" declaration,
      required_trigger declaration,
      required_array "nodes" "Workflow nodes" node_of_json declaration,
      required_array "edges" "Workflow edges" edge_of_json declaration,
      optional_object_field "Workflow" "loc" declaration )
  with
  | Ok name, Ok description, Ok trigger, Ok nodes, Ok edges, Ok loc ->
      Ok (Flow_payload { name; description; trigger; nodes; edges; loc })
  | name, description, trigger, nodes, edges, loc ->
      Error
        (diagnostics_of_result name
        @ diagnostics_of_result description
        @ diagnostics_of_result trigger
        @ diagnostics_of_result nodes
        @ diagnostics_of_result edges
        @ diagnostics_of_result loc)

let work_input_of_json index = function
  | Ir_json.Object entries -> (
      let name =
        entry_string
          (Printf.sprintf "$.inputs[%d].name" index)
          "Workflow work input" "name" entries
      in
      let type_ =
        match List.assoc_opt "type" entries with
        | None | Some Ir_json.Null -> Ok None
        | Some value -> Ok (Some value)
      in
      let required =
        (match List.assoc_opt "required" entries with
        | None | Some Ir_json.Null -> Ok None
        | Some (Ir_json.Bool value) -> Ok (Some value)
        | Some value -> Error [diagnostic (Printf.sprintf "$.inputs[%d].required" index)
            ("Workflow work input required must be a boolean, got " ^ json_kind value ^ ".")])
      in
      match (name, type_, required) with
      | Ok name, Ok type_, Ok required -> Ok { name; type_; required }
      | name, type_, required ->
          Error
            (diagnostics_of_result name
            @ diagnostics_of_result type_
            @ diagnostics_of_result required))
  | value ->
      Error
        [
          diagnostic
            (Printf.sprintf "$.inputs[%d]" index)
            (Printf.sprintf
               "Workflow work inputs entries must be objects, got %s."
               (json_kind value));
        ]

let work_item_of_declaration declaration =
  match
    ( required_string_field "Workflow work item" "name" declaration,
      required_string_field "Workflow work item" "title" declaration,
      optional_string_field "Workflow work item" "description" declaration,
      required_array "inputs" "Workflow work inputs" work_input_of_json
        declaration,
      optional_object_field "Workflow work item" "loc" declaration )
  with
  | Ok name, Ok title, Ok description, Ok inputs, Ok loc ->
      Ok (Work_item_payload { name; title; description; inputs; loc })
  | name, title, description, inputs, loc ->
      Error
        (diagnostics_of_result name
        @ diagnostics_of_result title
        @ diagnostics_of_result description
        @ diagnostics_of_result inputs
        @ diagnostics_of_result loc)

let of_declaration declaration =
  match Canonical_ir_decl.payload_string_field "kind" declaration with
  | Some "Process" ->
      flow_of_declaration declaration
      |> Result.map (fun payload -> Some payload)
  | Some "TaskDefinition" ->
      work_item_of_declaration declaration
      |> Result.map (fun payload -> Some payload)
  | _ -> Ok None

let validate_declaration declaration =
  match of_declaration declaration with
  | Ok _ -> []
  | Error diagnostics -> diagnostics
