open Ir_json

type declaration = { value : Ir_json.t }

let keyword_name value =
  if Stdlib.String.length value > 0 && value.[0] = ':' then
    Stdlib.String.sub value 1 (Stdlib.String.length value - 1)
  else value

let string_field key entries =
  match List.assoc_opt key entries with
  | Some (String value) -> Some value
  | _ -> None

let payload_entries entries =
  List.filter (fun (key, _) -> key <> "$summary") entries

let declaration_of_json = function
  | Object entries -> (
      match string_field "kind" entries with
      | Some _ -> Some { value = Object (payload_entries entries) }
      | None -> None)
  | _ -> None

let value_object_key = function
  | Eval.VKeyword value -> Some (keyword_name value)
  | Eval.VString value | Eval.VSymbol value -> Some value
  | _ -> None

let value_object_entry_names entries =
  let seen = Hashtbl.create (List.length entries) in
  let rec loop acc = function
    | [] -> Some (List.rev acc)
    | (key, _) :: rest -> (
        match value_object_key key with
        | None -> None
        | Some key_name ->
            if Hashtbl.mem seen key_name then None
            else (
              Hashtbl.add seen key_name true;
              loop (key_name :: acc) rest))
  in
  loop [] entries

let rec value_to_json = function
  | Eval.VNil -> Some Null
  | Eval.VBool value -> Some (Bool value)
  | Eval.VInt value -> Some (Int value)
  | Eval.VFloat value -> Some (Float value)
  | Eval.VString value | Eval.VSymbol value | Eval.VKeyword value ->
      Some (String value)
  | Eval.VList values | Eval.VVector values ->
      values_to_json values |> Option.map (fun values -> Array values)
  | (Eval.VMap entries | Eval.VDictionary entries) -> map_value_to_json entries
  | Eval.VClosure _ | Eval.VMacro _ -> None

and values_to_json values =
  let rec loop acc = function
    | [] -> Some (List.rev acc)
    | value :: rest -> (
        match value_to_json value with
        | Some value -> loop (value :: acc) rest
        | None -> None)
  in
  loop [] values

and map_value_to_json entries =
  match value_object_entry_names entries with
  | Some key_names ->
      let rec loop acc = function
        | [], [] -> Some (Object (List.rev acc))
        | key_name :: key_rest, (_, value) :: entry_rest -> (
            match value_to_json value with
            | Some value ->
                loop ((key_name, value) :: acc) (key_rest, entry_rest)
            | None -> None)
        | _ -> None
      in
      loop [] (key_names, entries)
  | None ->
      let rec loop acc = function
        | [] -> Some (Map (List.rev acc))
        | (key, value) :: rest -> (
            match (value_to_json key, value_to_json value) with
            | Some key, Some value -> loop ((key, value) :: acc) rest
            | _ -> None)
      in
      loop [] entries

let declaration_of_runtime_value = function
  | (Eval.VMap entries | Eval.VDictionary entries) -> (
      match map_value_to_json entries with
      | Some (Object _ as value) -> declaration_of_json value
      | _ -> None)
  | _ -> None

let payload_string_field key declaration =
  match declaration.value with
  | Object entries -> string_field key entries
  | _ -> None

let payload_field key declaration =
  match declaration.value with
  | Object entries -> List.assoc_opt key entries
  | _ -> None

let declaration_to_json declaration = declaration.value
