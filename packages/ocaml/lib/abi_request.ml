type source_bundle_item = { kind : string; source_id : string; source : string }
type unbound_symbol_match = { kind : string; value : string }

type unbound_symbol_policy = {
  match_ : unbound_symbol_match;
  type_kind : string option;
  type_name : string;
  reason : string option;
}

type type_policy = {
  unbound_symbols : unbound_symbol_policy list;
  default_builtin_scheme : string option;
}

type type_scheme_expr =
  | Scheme_type of string
  | Scheme_function of type_scheme_expr list * type_scheme_expr
  | Scheme_variadic_function of
      type_scheme_expr list * type_scheme_expr * type_scheme_expr
  | Scheme_list of type_scheme_expr
  | Scheme_map of type_scheme_expr * type_scheme_expr
  | Scheme_any
  | Scheme_unsupported of string

type host_builtin_descriptor = {
  name : string;
  effect_name : string option;
  type_scheme : type_scheme_expr option;
}

type t = {
  op : string;
  kind : string option;
  source_id : string option;
  source_ids : string list option;
  source : string option;
  source_bundle : source_bundle_item list option;
  session_id : string option;
  backend : string option;
  token : int option;
  offset : int option;
  result : string option;
  evaluation_id : string option;
  call_id : string option;
  resume_ok : bool option;
  value_json : string option;
  value_ref : string option;
  value_refs : string list;
  args_json : string list;
  failure_code : string option;
  failure_message : string option;
  type_policy : type_policy option;
  host_builtins : host_builtin_descriptor list;
}

let json_escape input =
  let buffer = Buffer.create (String.length input + 16) in
  String.iter
    (function
      | '"' -> Buffer.add_string buffer "\\\""
      | '\\' -> Buffer.add_string buffer "\\\\"
      | '\b' -> Buffer.add_string buffer "\\b"
      | '\012' -> Buffer.add_string buffer "\\f"
      | '\n' -> Buffer.add_string buffer "\\n"
      | '\r' -> Buffer.add_string buffer "\\r"
      | '\t' -> Buffer.add_string buffer "\\t"
      | c when Char.code c < 0x20 ->
          Buffer.add_string buffer (Printf.sprintf "\\u%04x" (Char.code c))
      | c -> Buffer.add_char buffer c)
    input;
  Buffer.contents buffer

let string_field name value =
  Printf.sprintf "\"%s\":\"%s\"" name (json_escape value)

let diagnostic_json ~code ~message =
  Printf.sprintf
    "{\"span\":null,\"severity\":\"error\",%s,%s,\"notes\":[],\"fixes\":[]}"
    (string_field "code" code)
    (string_field "message" message)

let find_string_field name json =
  let needle = "\"" ^ name ^ "\"" in
  let len = String.length json in
  let needle_len = String.length needle in
  let rec find_from i =
    if i + needle_len > len then None
    else if String.sub json i needle_len = needle then Some (i + needle_len)
    else find_from (i + 1)
  in
  let skip_ws i =
    let rec loop j =
      if j >= len then j
      else
        match json.[j] with ' ' | '\n' | '\r' | '\t' -> loop (j + 1) | _ -> j
    in
    loop i
  in
  let parse_string start =
    if start >= len || json.[start] <> '"' then None
    else
      let buffer = Buffer.create 16 in
      let rec loop i =
        if i >= len then None
        else
          match json.[i] with
          | '"' -> Some (Buffer.contents buffer)
          | '\\' when i + 1 < len ->
              let escaped =
                match json.[i + 1] with
                | '"' -> '"'
                | '\\' -> '\\'
                | '/' -> '/'
                | 'b' -> '\b'
                | 'f' -> '\012'
                | 'n' -> '\n'
                | 'r' -> '\r'
                | 't' -> '\t'
                | other -> other
              in
              Buffer.add_char buffer escaped;
              loop (i + 2)
          | c ->
              Buffer.add_char buffer c;
              loop (i + 1)
      in
      loop (start + 1)
  in
  let rec attempt start =
    match find_from start with
    | None -> None
    | Some after_name -> (
        let colon = skip_ws after_name in
        if colon >= len || json.[colon] <> ':' then attempt after_name
        else
          match parse_string (skip_ws (colon + 1)) with
          | Some value -> Some value
          | None -> attempt after_name)
  in
  attempt 0

let find_string_array_field name json =
  let needle = "\"" ^ name ^ "\"" in
  let len = String.length json in
  let needle_len = String.length needle in
  let rec find_from i =
    if i + needle_len > len then None
    else if String.sub json i needle_len = needle then Some (i + needle_len)
    else find_from (i + 1)
  in
  let skip_ws i =
    let rec loop j =
      if j >= len then j
      else
        match json.[j] with ' ' | '\n' | '\r' | '\t' -> loop (j + 1) | _ -> j
    in
    loop i
  in
  let parse_string start =
    if start >= len || json.[start] <> '"' then None
    else
      let buffer = Buffer.create 16 in
      let rec loop i =
        if i >= len then None
        else
          match json.[i] with
          | '"' -> Some (Buffer.contents buffer, i + 1)
          | '\\' when i + 1 < len ->
              let escaped =
                match json.[i + 1] with
                | '"' -> '"'
                | '\\' -> '\\'
                | '/' -> '/'
                | 'b' -> '\b'
                | 'f' -> '\012'
                | 'n' -> '\n'
                | 'r' -> '\r'
                | 't' -> '\t'
                | other -> other
              in
              Buffer.add_char buffer escaped;
              loop (i + 2)
          | c ->
              Buffer.add_char buffer c;
              loop (i + 1)
      in
      loop (start + 1)
  in
  let rec parse_items acc i =
    let i = skip_ws i in
    if i >= len then None
    else
      match json.[i] with
      | ']' -> Some (List.rev acc)
      | '"' -> (
          match parse_string i with
          | None -> None
          | Some (value, next) ->
              let next = skip_ws next in
              if next < len && json.[next] = ',' then
                parse_items (value :: acc) (next + 1)
              else
                let next = skip_ws next in
                if next < len && json.[next] = ']' then
                  Some (List.rev (value :: acc))
                else None)
      | _ -> None
  in
  match find_from 0 with
  | None -> None
  | Some after_name ->
      let colon = skip_ws after_name in
      if colon >= len || json.[colon] <> ':' then None
      else
        let array_start = skip_ws (colon + 1) in
        if array_start >= len || json.[array_start] <> '[' then None
        else parse_items [] (array_start + 1)

let find_int_field name json =
  let needle = "\"" ^ name ^ "\"" in
  let len = String.length json in
  let needle_len = String.length needle in
  let rec find_from i =
    if i + needle_len > len then None
    else if String.sub json i needle_len = needle then Some (i + needle_len)
    else find_from (i + 1)
  in
  let skip_ws i =
    let rec loop j =
      if j >= len then j
      else
        match json.[j] with ' ' | '\n' | '\r' | '\t' -> loop (j + 1) | _ -> j
    in
    loop i
  in
  let parse_int start =
    let finish = ref start in
    while
      !finish < len
      && match json.[!finish] with '0' .. '9' | '-' -> true | _ -> false
    do
      incr finish
    done;
    if !finish = start then None
    else int_of_string_opt (String.sub json start (!finish - start))
  in
  let rec attempt start =
    match find_from start with
    | None -> None
    | Some after_name -> (
        let colon = skip_ws after_name in
        if colon >= len || json.[colon] <> ':' then attempt after_name
        else
          match parse_int (skip_ws (colon + 1)) with
          | Some value -> Some value
          | None -> attempt after_name)
  in
  attempt 0

let find_bool_field name json =
  let needle = "\"" ^ name ^ "\"" in
  let len = String.length json in
  let needle_len = String.length needle in
  let rec find_from i =
    if i + needle_len > len then None
    else if String.sub json i needle_len = needle then Some (i + needle_len)
    else find_from (i + 1)
  in
  let skip_ws i =
    let rec loop j =
      if j >= len then j
      else
        match json.[j] with ' ' | '\n' | '\r' | '\t' -> loop (j + 1) | _ -> j
    in
    loop i
  in
  let rec attempt start =
    match find_from start with
    | None -> None
    | Some after_name ->
        let colon = skip_ws after_name in
        if colon >= len || json.[colon] <> ':' then attempt after_name
        else
          let value_start = skip_ws (colon + 1) in
          if value_start + 4 <= len && String.sub json value_start 4 = "true"
          then Some true
          else if
            value_start + 5 <= len && String.sub json value_start 5 = "false"
          then Some false
          else attempt after_name
  in
  attempt 0

let find_object_field = Abi_json_scan.find_object_field
let find_array_field = Abi_json_scan.find_array_field
let split_top_level_objects = Abi_json_scan.split_top_level_objects

let parse_unbound_symbol_policy item =
  match (find_object_field "match" item, find_object_field "type" item) with
  | Some match_json, Some type_json -> (
      match
        ( find_string_field "kind" match_json,
          find_string_field "value" match_json,
          find_string_field "name" type_json )
      with
      | Some kind, Some value, Some type_name ->
          Some
            {
              match_ = { kind; value };
              type_kind = find_string_field "kind" type_json;
              type_name;
              reason = find_string_field "reason" item;
            }
      | _ -> None)
  | _ -> None

let rec parse_type_scheme_expr json =
  match find_string_field "kind" json with
  | Some "type" -> (
      match find_string_field "name" json with
      | Some name -> Scheme_type name
      | None -> Scheme_unsupported "missing type name")
  | Some "function" -> (
      match find_object_field "result" json with
      | None -> Scheme_unsupported "missing function result"
      | Some result_json ->
          let params =
            match find_array_field "params" json with
            | None -> []
            | Some params_json ->
                params_json |> split_top_level_objects
                |> List.map parse_type_scheme_expr
          in
          Scheme_function (params, parse_type_scheme_expr result_json))
  | Some "variadic-function" -> (
      match
        (find_object_field "rest" json, find_object_field "result" json)
      with
      | Some rest_json, Some result_json ->
          let params =
            match find_array_field "params" json with
            | None -> []
            | Some params_json ->
                params_json |> split_top_level_objects
                |> List.map parse_type_scheme_expr
          in
          Scheme_variadic_function
            ( params,
              parse_type_scheme_expr rest_json,
              parse_type_scheme_expr result_json )
      | _ -> Scheme_unsupported "missing variadic function rest or result")
  | Some "list" -> (
      match find_object_field "item" json with
      | Some item_json -> Scheme_list (parse_type_scheme_expr item_json)
      | None -> Scheme_unsupported "missing list item")
  | Some "map" -> (
      match (find_object_field "key" json, find_object_field "value" json) with
      | Some key_json, Some value_json ->
          Scheme_map
            (parse_type_scheme_expr key_json, parse_type_scheme_expr value_json)
      | _ -> Scheme_unsupported "missing map key or value")
  | Some "any" -> Scheme_any
  | Some kind -> Scheme_unsupported kind
  | None -> Scheme_unsupported "missing kind"

let parse_host_builtin item =
  match find_string_field "name" item with
  | None -> None
  | Some name ->
      let effect_name =
        match find_object_field "handler" item with
        | None -> None
        | Some handler_json -> find_string_field "effect" handler_json
      in
      let type_scheme =
        match find_object_field "typeScheme" item with
        | None -> None
        | Some type_scheme_json ->
            Some (parse_type_scheme_expr type_scheme_json)
      in
      Some { name; effect_name; type_scheme }

let find_host_builtins_field json =
  match find_array_field "hostBuiltins" json with
  | None -> []
  | Some array_json ->
      array_json |> split_top_level_objects
      |> List.filter_map parse_host_builtin

let find_type_policy_field json =
  match find_object_field "typePolicy" json with
  | None -> None
  | Some type_policy_json ->
      let unbound_symbols =
        match find_array_field "unboundSymbols" type_policy_json with
        | None -> []
        | Some array_json ->
            array_json |> split_top_level_objects
            |> List.filter_map parse_unbound_symbol_policy
      in
      Some
        {
          unbound_symbols;
          default_builtin_scheme =
            find_string_field "defaultBuiltinScheme" type_policy_json;
        }

let find_source_bundle_field json =
  match find_array_field "sources" json with
  | None -> Ok None
  | Some array ->
      let invalid () = Error [diagnostic_json ~code:"abi/invalid-sources" ~message:"sources must be an array of objects with kind (source or prelude), a nonempty sourceId, and a source string."] in
      let rec loop acc seen offset =
        let offset=Abi_json_scan.skip_ws array offset in
        if offset >= String.length array then invalid ()
        else if array.[offset]=']' then Ok (Some (List.rev acc))
        else if array.[offset]<>'{' then invalid ()
        else match Abi_json_scan.find_matching array ~open_char:'{' ~close_char:'}' offset with
        | None -> invalid ()
        | Some finish ->
            let item=String.sub array offset (finish-offset+1) in
            match find_string_field "kind" item,find_string_field "sourceId" item,find_string_field "source" item with
            | Some (("source" | "prelude") as kind),Some source_id,Some source when source_id<>"" && not (List.mem source_id seen) ->
                let next=Abi_json_scan.skip_ws array (finish+1) in
                if next>=String.length array then invalid ()
                else if array.[next]=']' then Ok (Some (List.rev ({kind;source_id;source} :: acc)))
                else if array.[next]<>',' then invalid ()
                else let next=Abi_json_scan.skip_ws array (next+1) in
                  if next>=String.length array || array.[next]=']' then invalid ()
                  else loop ({kind;source_id;source} :: acc) (source_id :: seen) next
            | _ -> invalid () in
      loop [] [] 1

let decode json =
  match find_source_bundle_field json with
  | Error _ as error -> error
  | Ok source_bundle -> match find_string_field "op" json with
  | Some op ->
      Ok
        {
          op;
          kind = find_string_field "kind" json;
          source_id = find_string_field "sourceId" json;
          source_ids = find_string_array_field "sourceIds" json;
          source = find_string_field "source" json;
          source_bundle;
          session_id = find_string_field "sessionId" json;
          backend = find_string_field "backend" json;
          token = find_int_field "token" json;
          offset = find_int_field "offset" json;
          result = find_string_field "result" json;
          evaluation_id = find_string_field "evaluationId" json;
          call_id = find_string_field "callId" json;
          resume_ok = find_bool_field "resumeOk" json;
          value_json = find_object_field "value" json;
          value_ref = find_string_field "valueRef" json;
          value_refs =
            Option.value (find_string_array_field "valueRefs" json) ~default:[];
          args_json =
            (match find_array_field "args" json with
            | None -> []
            | Some args_json -> split_top_level_objects args_json);
          failure_code = find_string_field "failureCode" json;
          failure_message = find_string_field "failureMessage" json;
          type_policy = find_type_policy_field json;
          host_builtins = find_host_builtins_field json;
        }
  | None ->
      Error
        [
          diagnostic_json ~code:"abi/missing-op"
            ~message:"Request JSON must include a string op field.";
        ]
