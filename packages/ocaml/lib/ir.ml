type diagnostic = { path : string; code : string; message : string }

let diagnostic ~path ~code ~message = { path; code; message }

let keyword_name value =
  if String.length value > 0 && value.[0] = ':' then
    String.sub value 1 (String.length value - 1)
  else value

let object_key = function
  | Eval.VKeyword value -> Some (keyword_name value)
  | Eval.VString value | Eval.VSymbol value -> Some value
  | _ -> None

let object_entry_names entries =
  let seen = Hashtbl.create (List.length entries) in
  let rec loop acc = function
    | [] -> Some (List.rev acc)
    | (key, _) :: rest -> (
        match object_key key with
        | None -> None
        | Some key_name ->
            if Hashtbl.mem seen key_name then None
            else (
              Hashtbl.add seen key_name true;
              loop (key_name :: acc) rest))
  in
  loop [] entries

let collect_results items =
  let rec loop values diagnostics = function
    | [] ->
        if diagnostics = [] then Ok (List.rev values)
        else Error (List.rev diagnostics)
    | item :: rest -> (
        match item with
        | Ok value -> loop (value :: values) diagnostics rest
        | Error item_diagnostics ->
            loop values (List.rev_append item_diagnostics diagnostics) rest)
  in
  loop [] [] items

let rec json_of_value ~path = function
  | Eval.VNil -> Ok Ir_json.Null
  | Eval.VBool value -> Ok (Ir_json.Bool value)
  | Eval.VInt value -> Ok (Ir_json.Int value)
  | Eval.VFloat value -> Ok (Ir_json.Float value)
  | Eval.VString value | Eval.VSymbol value | Eval.VKeyword value ->
      Ok (Ir_json.String value)
  | Eval.VList values | Eval.VVector values ->
      values
      |> List.mapi (fun index value ->
          json_of_value ~path:(Printf.sprintf "%s[%d]" path index) value)
      |> collect_results
      |> Result.map (fun values -> Ir_json.Array values)
  | (Eval.VMap entries | Eval.VDictionary entries) -> json_of_map ~path entries
  | Eval.VClosure _ ->
      Error
        [
          diagnostic ~path ~code:"ir/non-serializable-value"
            ~message:"Canonical IR cannot contain runtime closure values.";
        ]
  | Eval.VMacro _ ->
      Error
        [
          diagnostic ~path ~code:"ir/non-serializable-value"
            ~message:"Canonical IR cannot contain runtime macro values.";
        ]

and json_of_map ~path entries =
  match object_entry_names entries with
  | Some key_names ->
      List.combine key_names entries
      |> List.map (fun (key_name, (_, value)) ->
          json_of_value ~path:(Printf.sprintf "%s.%s" path key_name) value
          |> Result.map (fun value_json -> (key_name, value_json)))
      |> collect_results
      |> Result.map (fun entries -> Ir_json.Object entries)
  | None ->
      entries
      |> List.mapi (fun index (key, value) ->
          match
            ( json_of_value ~path:(Printf.sprintf "%s.<key:%d>" path index) key,
              json_of_value
                ~path:(Printf.sprintf "%s.<value:%d>" path index)
                value )
          with
          | Ok key_json, Ok value_json -> Ok (key_json, value_json)
          | Error diagnostics, Ok _ | Ok _, Error diagnostics ->
              Error diagnostics
          | Error left, Error right -> Error (left @ right))
      |> collect_results
      |> Result.map (fun entries -> Ir_json.Map entries)

let value_to_json value =
  match json_of_value ~path:"$" value with
  | Ok json -> Ir_json.to_string json
  | Error _ -> "null"

let declarations_to_json declarations =
  declarations
  |> List.mapi (fun index declaration ->
      match
        json_of_value
          ~path:(Printf.sprintf "$.declarations[%d]" index)
          declaration
      with
      | Ok json -> json
      | Error _ -> Ir_json.Null)
  |> fun declarations -> Ir_json.to_string (Ir_json.Array declarations)

let declaration_count declarations = List.length declarations

let validate_declarations declarations =
  declarations
  |> List.mapi (fun index value ->
      match
        json_of_value ~path:(Printf.sprintf "$.declarations[%d]" index) value
      with
      | Ok _ -> []
      | Error diagnostics -> diagnostics)
  |> List.concat

let diagnostic_to_json ~span diagnostic =
  Diagnostic.to_json
    (Diagnostic.error ~path:diagnostic.path ~span ~code:diagnostic.code
       ~message:diagnostic.message ())
