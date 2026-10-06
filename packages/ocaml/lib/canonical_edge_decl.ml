[@@@warning "-69"]

type diagnostic = { path : string; message : string }

type relation_field = {
  name : string;
  type_ : Ir_json.t;
  required : Ir_json.t option;
  indexed : Ir_json.t option;
}

type relation = {
  name : string;
  source : string;
  target : string;
  fields : relation_field list;
}

type link_field = { name : string; value : Ir_json.t }

type link = {
  relation : string;
  source : string;
  target : string;
  source_id : string option;
  target_id : string option;
  fields : link_field list;
}

type t = Relation_payload of relation | Link_payload of link

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

let non_null path label field = function
  | Ir_json.Null ->
      Error
        [
          diagnostic path
            (Printf.sprintf "%s field %s must not be null." label field);
        ]
  | value -> Ok value

let field_name path label entries =
  match List.assoc_opt "name" entries with
  | Some (Ir_json.String value) when value <> "" -> Ok value
  | Some (Ir_json.String _) ->
      Error
        [
          diagnostic path
            (Printf.sprintf "%s field name must not be empty." label);
        ]
  | Some value ->
      Error
        [
          diagnostic path
            (Printf.sprintf "%s field name must be a string, got %s." label
               (json_kind value));
        ]
  | None ->
      Error
        [
          diagnostic path (Printf.sprintf "%s field must include a name." label);
        ]

let optional_entry name entries =
  match List.assoc_opt name entries with
  | None | Some Ir_json.Null -> None
  | Some value -> Some value

let relation_field_of_json index = function
  | Ir_json.Object entries -> (
      let name_path = Printf.sprintf "$.fields[%d].name" index in
      let type_path = Printf.sprintf "$.fields[%d].type" index in
      let name = field_name name_path "Relation" entries in
      let type_ =
        match List.assoc_opt "type" entries with
        | Some value -> non_null type_path "Relation" "type" value
        | None ->
            Error [ diagnostic type_path "Relation field must include a type." ]
      in
      match (name, type_) with
      | Ok name, Ok type_ ->
          Ok
            {
              name;
              type_;
              required = optional_entry "required" entries;
              indexed = optional_entry "indexed" entries;
            }
      | _ ->
          let diagnostics_of_result = function
            | Ok _ -> []
            | Error diagnostics -> diagnostics
          in
          Error (diagnostics_of_result name @ diagnostics_of_result type_))
  | value ->
      Error
        [
          diagnostic
            (Printf.sprintf "$.fields[%d]" index)
            (Printf.sprintf "Relation fields entries must be objects, got %s."
               (json_kind value));
        ]

let link_field_of_json index = function
  | Ir_json.Object entries -> (
      let name_path = Printf.sprintf "$.fields[%d].name" index in
      let value_path = Printf.sprintf "$.fields[%d].value" index in
      let name = field_name name_path "Link" entries in
      let value =
        match List.assoc_opt "value" entries with
        | Some value -> Ok value
        | None ->
            Error [ diagnostic value_path "Link field must include a value." ]
      in
      match (name, value) with
      | Ok name, Ok value -> Ok { name; value }
      | _ ->
          let diagnostics_of_result = function
            | Ok _ -> []
            | Error diagnostics -> diagnostics
          in
          Error (diagnostics_of_result name @ diagnostics_of_result value))
  | value ->
      Error
        [
          diagnostic
            (Printf.sprintf "$.fields[%d]" index)
            (Printf.sprintf "Link fields entries must be objects, got %s."
               (json_kind value));
        ]

let required_fields label parse declaration =
  let fields=Canonical_ir_decl.payload_field "fields" declaration in
  let fields=match label,fields with
    | "Link",Some (Ir_json.Object entries) -> Some (Ir_json.Array
        (List.map (fun (name,value) -> Ir_json.Object ["name",Ir_json.String name;"value",value]) entries))
    | _ -> fields in
  match fields with
  | Some (Ir_json.Array values) ->
      let rec loop acc diagnostics index = function
        | [] ->
            if diagnostics = [] then Ok (List.rev acc) else Error diagnostics
        | value :: rest -> (
            match parse index value with
            | Ok field -> loop (field :: acc) diagnostics (index + 1) rest
            | Error field_diagnostics ->
                loop acc (diagnostics @ field_diagnostics) (index + 1) rest)
      in
      loop [] [] 0 values
  | Some value ->
      Error
        [
          diagnostic "$.fields"
            (Printf.sprintf "%s payload field fields must be an array, got %s."
               label (json_kind value));
        ]
  | None ->
      Error
        [
          diagnostic "$.fields"
            (Printf.sprintf "%s payload must include an array fields field."
               label);
        ]

let diagnostics_of_result = function
  | Ok _ -> []
  | Error diagnostics -> diagnostics

let relation_of_declaration declaration =
  match
    ( required_string_field "Relation" "name" declaration,
      required_string_field "Relation" "source" declaration,
      required_string_field "Relation" "target" declaration,
      required_fields "Relation" relation_field_of_json declaration )
  with
  | Ok name, Ok source, Ok target, Ok fields ->
      Ok (Relation_payload { name; source; target; fields })
  | name, source, target, fields ->
      Error
        (diagnostics_of_result name
        @ diagnostics_of_result source
        @ diagnostics_of_result target
        @ diagnostics_of_result fields)

let link_of_declaration declaration =
  match
    ( required_string_field "Link" "relation" declaration,
      required_string_field "Link" "source" declaration,
      required_string_field "Link" "target" declaration,
      optional_string_field "Link" "sourceId" declaration,
      optional_string_field "Link" "targetId" declaration,
      required_fields "Link" link_field_of_json declaration )
  with
  | Ok relation, Ok source, Ok target, Ok source_id, Ok target_id, Ok fields ->
      Ok
        (Link_payload { relation; source; target; source_id; target_id; fields })
  | relation, source, target, source_id, target_id, fields ->
      Error
        (diagnostics_of_result relation
        @ diagnostics_of_result source
        @ diagnostics_of_result target
        @ diagnostics_of_result source_id
        @ diagnostics_of_result target_id
        @ diagnostics_of_result fields)

let of_declaration declaration =
  match Canonical_ir_decl.payload_string_field "kind" declaration with
  | Some "Relation" ->
      relation_of_declaration declaration |> Result.map (fun edge -> Some edge)
  | Some "Link" ->
      link_of_declaration declaration |> Result.map (fun edge -> Some edge)
  | _ -> Ok None

let validate_declaration declaration =
  match of_declaration declaration with
  | Ok _ -> []
  | Error diagnostics -> diagnostics
