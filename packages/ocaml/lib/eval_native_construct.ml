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

let kw name = VKeyword (":" ^ name)
let str value = VString value

let obj entries =
  VMap (List.map (fun (name, value) -> (kw name, value)) entries)

let ref_obj kind name = obj [ ("kind", str kind); ("name", str name) ]
let lookup env name = Env.lookup name env

let scalar_string value =
  match Eval_slot.scalar_string value with
  | Some value -> Some value
  | None -> None

let string_or_nil value =
  match scalar_string value with Some value -> str value | None -> VNil

let identifier env input name =
  Eval_slot.identifier_value_with_lookup ~lookup:(lookup env) input (kw name)
  |> string_or_nil

let identifier_string env input name =
  Eval_slot.identifier_value_with_lookup ~lookup:(lookup env) input (kw name)
  |> scalar_string

let slot_string env input name =
  Eval_slot.slot_value_with_lookup ~lookup:(lookup env) input (kw name)
  |> string_or_nil

let slot_string_option env input name =
  Eval_slot.slot_value_with_lookup ~lookup:(lookup env) input (kw name)
  |> scalar_string

let slot_value env input name =
  Eval_slot.slot_value_with_lookup ~lookup:(lookup env) input (kw name)

let slot_symbol env input name =
  let value =
    Eval_slot.slot_value_with_lookup ~lookup:(lookup env) input (kw name)
  in
  match scalar_string value with Some value -> str value | None -> value

let slot_string_list env input name =
  Eval_slot.slot_value_with_lookup ~lookup:(lookup env) input (kw name)
  |> Eval_slot.string_list_value

let child_forms env input name =
  Eval_slot.child_forms_with_lookup ~lookup:(lookup env) input (kw name)

let summary kind name result_type =
  let named =
    Option.fold ~none:[] ~some:(fun name -> [ ("name", str name) ]) name
  in
  obj ([ ("kind", str kind) ] @ named @ [ ("resultType", str result_type) ])

let value_text = function
  | VString value | VSymbol value | VKeyword value -> Some value
  | _ -> None

let value_clauses = function
  | VMap entries -> (
      match Value.lookup_map entries (VKeyword ":clauses") with
      | Some (VList clauses) | Some (VVector clauses) -> clauses
      | _ -> [])
  | _ -> []

type source =
  | Identifier of string
  | Slot_string of string
  | Slot_string_list of string
  | Slot_symbol of string
  | Slot_expr of string
  | Slot_runtime_expr of string
  | Positional of int
  | Loc
  | Format of source list
  | Default of source * string
  | First of source list
  | Ref of string * source
  | Object of object_field list
  | Child of string * object_field list
  | Children of string * object_field list
  | When of source * source
  | Primitive of string * source
  | Literal of string

and object_field = { object_output : string; object_source : source }

type field =
  | Source_field of { output : string; source : source }
  | Assignments_field of {
      output : string;
      child : string;
      key : string;
      value : string;
      default : string option;
    }

type shape = {
  form : string;
  kind : string;
  result_type : string;
  name_output : string option;
  name_source : source option;
  name_default : string option;
  fields : field list;
}

let clause name clauses =
  clauses
  |> List.find_map (function
    | (VList (VKeyword key :: values) | VVector (VKeyword key :: values))
      when key = ":" ^ name ->
        Some values
    | _ -> None)

let value_int = function VInt value -> Some value | _ -> None

let rec parse_source = function
  | VList [ VKeyword ":identifier"; name ]
  | VVector [ VKeyword ":identifier"; name ] ->
      Option.map (fun name -> Identifier name) (value_text name)
  | VList [ VKeyword ":slot-string"; name ]
  | VVector [ VKeyword ":slot-string"; name ] ->
      Option.map (fun name -> Slot_string name) (value_text name)
  | VList [ VKeyword ":slot-string-list"; name ]
  | VVector [ VKeyword ":slot-string-list"; name ] ->
      Option.map (fun name -> Slot_string_list name) (value_text name)
  | VList [ VKeyword ":slot-symbol"; name ]
  | VVector [ VKeyword ":slot-symbol"; name ] ->
      Option.map (fun name -> Slot_symbol name) (value_text name)
  | VList [ VKeyword ":slot-expr"; name ]
  | VVector [ VKeyword ":slot-expr"; name ] ->
      Option.map (fun name -> Slot_expr name) (value_text name)
  | VList [ VKeyword ":slot-runtime-expr"; name ]
  | VVector [ VKeyword ":slot-runtime-expr"; name ] ->
      Option.map (fun name -> Slot_runtime_expr name) (value_text name)
  | VList [ VKeyword ":positional"; index ]
  | VVector [ VKeyword ":positional"; index ] ->
      Option.map (fun index -> Positional index) (value_int index)
  | VList [ VKeyword ":loc" ] | VVector [ VKeyword ":loc" ] -> Some Loc
  | VList (VKeyword ":format" :: parts) | VVector (VKeyword ":format" :: parts)
    ->
      let parse_part value =
        match parse_source value with
        | Some source -> Some source
        | None -> Option.map (fun value -> Literal value) (value_text value)
      in
      let parsed_parts = List.filter_map parse_part parts in
      if List.length parsed_parts = List.length parts then
        Some (Format parsed_parts)
      else None
  | VList [ VKeyword ":default"; source; fallback ]
  | VVector [ VKeyword ":default"; source; fallback ] -> (
      match (parse_source source, value_text fallback) with
      | Some source, Some fallback -> Some (Default (source, fallback))
      | _ -> None)
  | VList (VKeyword ":first" :: sources) | VVector (VKeyword ":first" :: sources)
    ->
      let parsed_sources = List.filter_map parse_source sources in
      if sources <> [] && List.length parsed_sources = List.length sources then
        Some (First parsed_sources)
      else None
  | VList [ VKeyword ":ref"; kind; source ]
  | VVector [ VKeyword ":ref"; kind; source ] -> (
      match (value_text kind, parse_source source) with
      | Some kind, Some source -> Some (Ref (kind, source))
      | _ -> None)
  | VList (VKeyword ":object" :: fields) | VVector (VKeyword ":object" :: fields)
    ->
      Option.map (fun fields -> Object fields) (parse_object_fields fields)
  | VList (VKeyword ":child" :: child :: fields)
  | VVector (VKeyword ":child" :: child :: fields) -> (
      match (value_text child, parse_object_fields fields) with
      | Some child, Some fields -> Some (Child (child, fields))
      | _ -> None)
  | VList (VKeyword ":children" :: child :: fields)
  | VVector (VKeyword ":children" :: child :: fields) -> (
      match (value_text child, parse_object_fields fields) with
      | Some child, Some fields -> Some (Children (child, fields))
      | _ -> None)
  | VList [ VKeyword ":when"; condition; source ]
  | VVector [ VKeyword ":when"; condition; source ] -> (
      match (parse_source condition, parse_source source) with
      | Some condition, Some source -> Some (When (condition, source))
      | _ -> None)
  | VList [ VKeyword ":primitive"; name; source ]
  | VVector [ VKeyword ":primitive"; name; source ] -> (
      match (value_text name, parse_source source) with
      | Some name, Some source -> Some (Primitive (name, source))
      | _ -> None)
  | VList [ VKeyword ":literal"; value ]
  | VVector [ VKeyword ":literal"; value ] ->
      Option.map (fun value -> Literal value) (value_text value)
  | _ -> None

and parse_object_field = function
  | VList [ VKeyword ":field"; output; source ]
  | VVector [ VKeyword ":field"; output; source ] -> (
      match (value_text output, parse_source source) with
      | Some object_output, Some object_source ->
          Some { object_output; object_source }
      | _ -> None)
  | _ -> None

and parse_object_fields fields =
  let parsed = List.filter_map parse_object_field fields in
  if List.length parsed = List.length fields then Some parsed else None

let parse_default options =
  options
  |> List.find_map (function
    | VList [ VKeyword ":default"; value ]
    | VVector [ VKeyword ":default"; value ] ->
        value_text value
    | _ -> None)

let parse_option name options =
  options
  |> List.find_map (function
    | (VList [ VKeyword key; value ] | VVector [ VKeyword key; value ])
      when key = ":" ^ name ->
        value_text value
    | _ -> None)

let parse_assignments output = function
  | VList (VKeyword ":assignments" :: child :: options)
  | VVector (VKeyword ":assignments" :: child :: options) -> (
      match value_text child with
      | None -> None
      | Some child -> (
          let key = parse_option "key" options in
          let value = parse_option "value" options in
          let default = parse_option "default" options in
          match (key, value) with
          | Some key, Some value ->
              Some (Assignments_field { output; child; key; value; default })
          | _ -> None))
  | _ -> None

let parse_field = function
  | VList [ VKeyword ":field"; output; source ]
  | VVector [ VKeyword ":field"; output; source ] -> (
      match value_text output with
      | Some output -> (
          match parse_source source with
          | Some source -> Some (Source_field { output; source })
          | None -> parse_assignments output source)
      | None -> None)
  | _ -> None

let parse_shape clauses =
  match
    (clause "form" clauses, clause "kind" clauses, clause "result-type" clauses)
  with
  | Some [ form ], Some [ kind ], Some [ result_type ] -> (
      match (value_text form, value_text kind, value_text result_type) with
      | Some form, Some kind, Some result_type ->
          let name_shape =
            match clause "name" clauses with
            | Some (output :: source :: options) -> (
                match (value_text output, parse_source source) with
                | Some name_output, Some name_source ->
                    Some
                      (Some name_output, Some name_source, parse_default options)
                | _ -> None)
            | Some _ -> None
            | None -> Some (None, None, None)
          in
          Option.map
            (fun (name_output, name_source, name_default) ->
              let fields = List.filter_map parse_field clauses in
              {
                form;
                kind;
                result_type;
                name_output;
                name_source;
                name_default;
                fields;
              })
            name_shape
      | _ -> None)
  | _ -> None

let rec source_value env input = function
  | Identifier name -> identifier env input name
  | Slot_string name -> slot_string env input name
  | Slot_string_list name -> slot_string_list env input name
  | Slot_symbol name -> slot_symbol env input name
  | Slot_expr name | Slot_runtime_expr name -> slot_value env input name
  | Positional index -> Eval_slot.positional_arg input index
  | Loc -> VNil
  | Format parts ->
      str
        (String.concat ""
           (List.map
              (fun part ->
                match source_string env input part with
                | Some value -> value
                | None -> "")
              parts))
  | Default (source, fallback) -> (
      match source_value env input source with
      | VNil | VBool false -> str fallback
      | value -> value)
  | First sources -> (
      match
        List.find_map
          (fun source ->
            match source_value env input source with
            | VNil | VBool false -> None
            | value -> Some value)
          sources
      with
      | Some value -> value
      | None -> VNil)
  | Ref (kind, source) -> (
      match source_string env input source with
      | Some name -> ref_obj kind name
      | None -> VNil)
  | Object fields ->
      obj
        (List.map
           (fun { object_output; object_source } ->
             (object_output, source_value env input object_source))
           fields)
  | Child (child, fields) -> (
      match child_forms env input child with
      | child_value :: _ -> source_value env child_value (Object fields)
      | [] -> VNil)
  | Children (child, fields) ->
      VList
        (List.map
           (fun child_value -> source_value env child_value (Object fields))
           (child_forms env input child))
  | When (condition, source) -> (
      match source_value env input condition with
      | VNil | VBool false -> VNil
      | _ -> source_value env input source)
  | Primitive (name, source) ->
      primitive_value name (source_value env input source)
  | Literal value -> str value

and source_string env input source =
  match source_value env input source with
  | VString value | VSymbol value | VKeyword value -> Some value
  | value -> scalar_string value

and primitive_value name value =
  match name with
  | "attribute-binding" -> attribute_binding value
  | _ -> failwith ("unknown elaboration primitive: " ^ name)

and attribute_binding value =
  let values =
    match value with
    | VList values | VVector values -> values
    | VNil -> []
    | value -> [ value ]
  in
  let nth_string index =
    if index < 0 || index >= List.length values then None
    else
      match List.nth values index with
      | VString value | VSymbol value | VKeyword value -> Some value
      | value -> scalar_string value
  in
  let option_string index key =
    match nth_string index with
    | Some actual when actual = key -> nth_string (index + 1)
    | _ -> None
  in
  let first_option key =
    match option_string 1 key with
    | Some _ as value -> value
    | None -> (
        match option_string 3 key with
        | Some _ as value -> value
        | None -> option_string 5 key)
  in
  match values with
  | [] -> VNil
  | _ ->
      obj
        [
          ("kind", str "AttributeBinding");
          ("attribute", Option.fold ~none:VNil ~some:str (nth_string 0));
          ( "transform",
            Option.fold ~none:VNil ~some:str (first_option ":transform") );
          ("entity", Option.fold ~none:VNil ~some:str (first_option ":entity"));
          ( "cardinality",
            Option.fold ~none:VNil ~some:str (first_option ":cardinality") );
        ]

let run_assignments_field env input output child key value default =
  let entries =
    child_forms env input child
    |> List.fold_left
         (fun entries child_value ->
           match identifier_string env child_value key with
           | None -> entries
           | Some name ->
               let value =
                 match default with
                 | Some default ->
                     str
                       (Option.value ~default
                          (slot_string_option env child_value value))
                 | None -> slot_symbol env child_value value
               in
               let key = str name in
               (key, value)
               :: List.filter
                    (fun (entry_key, _) -> not (Value.equal entry_key key))
                    entries)
         []
  in
  (output, VMap entries)

let run_field env input = function
  | Source_field { output; source } -> (output, source_value env input source)
  | Assignments_field { output; child; key; value; default } ->
      run_assignments_field env input output child key value default

let shape_for_hook env hook =
  Env.bindings env
  |> List.find_map (fun (_name, value) ->
      match Descriptor.kind value with
      | Some "elaboration" -> (
          let clauses = value_clauses value in
          match clause "hook" clauses with
          | Some [ hook_value ] when value_text hook_value = Some hook -> (
              match parse_shape clauses with
              | Some shape
                when Descriptor.construct_hook env shape.form = Some hook ->
                  Some shape
              | _ -> None)
          | _ -> None)
      | _ -> None)

let run_shape env input shape =
  let name =
    match shape.name_source with
    | Some source -> (
        match source_string env input source with
        | Some name -> Some name
        | None -> shape.name_default)
    | None -> None
  in
  let fields = List.map (run_field env input) shape.fields in
  let rec insert_summary name_output = function
    | [] -> [ ("$summary", summary shape.kind name shape.result_type) ]
    | ((field_name, _) as field) :: rest when field_name = name_output ->
        field :: ("$summary", summary shape.kind name shape.result_type) :: rest
    | field :: rest -> field :: insert_summary name_output rest
  in
  match shape.name_output with
  | Some name_output ->
      obj (("kind", str shape.kind) :: insert_summary name_output fields)
  | None ->
      obj
        (("kind", str shape.kind)
        :: ("$summary", summary shape.kind None shape.result_type)
        :: fields)

let descriptor_construct env hook input =
  Option.map (run_shape env input) (shape_for_hook env hook)

let has_descriptor env hook = Option.is_some (shape_for_hook env hook)

let native_elaboration_disabled () =
  match Sys.getenv_opt "FORMA_DISABLE_NATIVE_ELABORATION" with
  | Some ("1" | "true" | "TRUE" | "yes" | "YES") -> true
  | _ -> false

let apply ?(fallback_available = true) env name input =
  if native_elaboration_disabled () && fallback_available then None
  else
    match descriptor_construct env name input with
    | Some _ as value -> value
    | None -> None
