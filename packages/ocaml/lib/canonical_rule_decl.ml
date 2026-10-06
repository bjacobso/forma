[@@@warning "-69"]

type diagnostic = { path : string; message : string }

type assignment = {
  role : string option;
  priority : string option;
  title : Ir_json.t option;
  body : Ir_json.t option;
}

type resolution = {
  label : string option;
  action : string option;
  mutation : string option;
  auto : string option;
}

type t = {
  name : string;
  doc : string option;
  entity : string;
  severity : string;
  condition : Ir_json.t;
  message : Ir_json.t;
  task_assignments : assignment list option;
  resolutions : resolution list;
  loc : Ir_json.t option;
}

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

let required_string_field field declaration =
  match Canonical_ir_decl.payload_field field declaration with
  | Some (Ir_json.String value) -> Ok value
  | Some value ->
      Error
        [
          diagnostic (field_path field)
            (Printf.sprintf "Rule payload field %s must be a string, got %s."
               field (json_kind value));
        ]
  | None ->
      Error
        [
          diagnostic (field_path field)
            (Printf.sprintf "Rule payload must include a textual %s field."
               field);
        ]

let optional_string_entry path name entries =
  match List.assoc_opt name entries with
  | None | Some Ir_json.Null -> Ok None
  | Some (Ir_json.String value) -> Ok (Some value)
  | Some value ->
      Error
        [
          diagnostic path
            (Printf.sprintf "Rule payload field %s must be a string, got %s."
               name (json_kind value));
        ]

let optional_string_field field declaration =
  match Canonical_ir_decl.payload_field field declaration with
  | None | Some Ir_json.Null -> Ok None
  | Some (Ir_json.String value) -> Ok (Some value)
  | Some value ->
      Error
        [
          diagnostic (field_path field)
            (Printf.sprintf "Rule payload field %s must be a string, got %s."
               field (json_kind value));
        ]

let optional_object_field field declaration =
  match Canonical_ir_decl.payload_field field declaration with
  | None | Some Ir_json.Null -> Ok None
  | Some (Ir_json.Object _ as value) -> Ok (Some value)
  | Some value ->
      Error
        [
          diagnostic (field_path field)
            (Printf.sprintf "Rule payload field %s must be an object, got %s."
               field (json_kind value));
        ]

let required_payload field declaration =
  match Canonical_ir_decl.payload_field field declaration with
  | Some Ir_json.Null ->
      Error
        [
          diagnostic (field_path field)
            (Printf.sprintf "Rule payload %s field must not be null." field);
        ]
  | Some value -> Ok value
  | None ->
      Error
        [
          diagnostic (field_path field)
            (Printf.sprintf "Rule payload must include a %s field." field);
        ]

let optional_entry name entries =
  match List.assoc_opt name entries with
  | None | Some Ir_json.Null -> None
  | Some value -> Some value

let diagnostics_of_result = function
  | Ok _ -> []
  | Error diagnostics -> diagnostics

let assignment_of_json index = function
  | Ir_json.Object entries -> (
      let role =
        optional_string_entry
          (Printf.sprintf "$.taskAssignments[%d].role" index)
          "role" entries
      in
      let priority =
        optional_string_entry
          (Printf.sprintf "$.taskAssignments[%d].priority" index)
          "priority" entries
      in
      match (role, priority) with
      | Ok role, Ok priority ->
          Ok
            {
              role;
              priority;
              title = optional_entry "title" entries;
              body = optional_entry "body" entries;
            }
      | role, priority ->
          Error (diagnostics_of_result role @ diagnostics_of_result priority))
  | value ->
      Error
        [
          diagnostic
            (Printf.sprintf "$.taskAssignments[%d]" index)
            (Printf.sprintf
               "Rule task assignment entries must be objects, got %s."
               (json_kind value));
        ]

let resolution_of_json index = function
  | Ir_json.Object entries -> (
      let label =
        optional_string_entry
          (Printf.sprintf "$.resolutions[%d].label" index)
          "label" entries
      in
      let action =
        optional_string_entry
          (Printf.sprintf "$.resolutions[%d].action" index)
          "action" entries
      in
      let mutation =
        optional_string_entry
          (Printf.sprintf "$.resolutions[%d].mutation" index)
          "mutation" entries
      in
      let auto =
        optional_string_entry
          (Printf.sprintf "$.resolutions[%d].auto" index)
          "auto" entries
      in
      match (label, action, mutation, auto) with
      | Ok label, Ok action, Ok mutation, Ok auto ->
          Ok { label; action; mutation; auto }
      | label, action, mutation, auto ->
          Error
            (diagnostics_of_result label
            @ diagnostics_of_result action
            @ diagnostics_of_result mutation
            @ diagnostics_of_result auto))
  | value ->
      Error
        [
          diagnostic
            (Printf.sprintf "$.resolutions[%d]" index)
            (Printf.sprintf "Rule resolution entries must be objects, got %s."
               (json_kind value));
        ]

let array_items field parse declaration =
  match Canonical_ir_decl.payload_field field declaration with
  | Some (Ir_json.Array values) ->
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
  | Some value ->
      Error
        [
          diagnostic (field_path field)
            (Printf.sprintf "Rule payload field %s must be an array, got %s."
               field (json_kind value));
        ]
  | None ->
      Error
        [
          diagnostic (field_path field)
            (Printf.sprintf "Rule payload must include an array %s field." field);
        ]

let optional_array_items field parse declaration =
  match Canonical_ir_decl.payload_field field declaration with
  | None | Some Ir_json.Null -> Ok None
  | Some _ ->
      array_items field parse declaration
      |> Result.map (fun items -> Some items)

let rule_of_declaration declaration =
  match
    ( required_string_field "name" declaration,
      optional_string_field "doc" declaration,
      required_string_field "entity" declaration,
      required_string_field "severity" declaration,
      (match Canonical_ir_decl.payload_field "when" declaration, Canonical_ir_decl.payload_field "query" declaration with
       | Some value,None | None,Some value when value<>Ir_json.Null -> Ok value
       | _ -> Error [diagnostic "$.when" "A constraint requires exactly one of when or query."]),
      required_payload "message" declaration,
      optional_array_items "taskAssignments" assignment_of_json declaration,
      array_items "resolutions" resolution_of_json declaration,
      optional_object_field "loc" declaration )
  with
  | ( Ok name,
      Ok doc,
      Ok entity,
      Ok severity,
      Ok condition,
      Ok message,
      Ok task_assignments,
      Ok resolutions,
      Ok loc ) ->
      Ok
        {
          name;
          doc;
          entity;
          severity;
          condition;
          message;
          task_assignments;
          resolutions;
          loc;
        }
  | results ->
      let ( name,
            doc,
            entity,
            severity,
            condition,
            message,
            task_assignments,
            resolutions,
            loc ) =
        results
      in
      Error
        (diagnostics_of_result name @ diagnostics_of_result doc
        @ diagnostics_of_result entity
        @ diagnostics_of_result severity
        @ diagnostics_of_result condition
        @ diagnostics_of_result message
        @ diagnostics_of_result task_assignments
        @ diagnostics_of_result resolutions
        @ diagnostics_of_result loc)

let of_declaration declaration =
  match Canonical_ir_decl.payload_string_field "kind" declaration with
  | Some "Constraint" ->
      rule_of_declaration declaration |> Result.map (fun rule -> Some rule)
  | _ -> Ok None

let validate_declaration declaration =
  match of_declaration declaration with
  | Ok _ -> []
  | Error diagnostics -> diagnostics
