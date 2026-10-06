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

type action_field_kind =
  | ActionString
  | ActionExpr
  | ActionJson
  | ActionLiteral
  | ActionStringList

type action_mechanism_config = {
  string_mechanism : string;
  expr_mechanism : string;
  json_mechanism : string;
  literal_mechanism : string;
  string_list_mechanism : string;
}

type action_field_spec = {
  input_name : string;
  field : string;
  kind : action_field_kind;
  optional : bool;
}

type action_callback_spec = { input_name : string; field : string }

type action_spec = {
  discriminator_field : string;
  tag : string;
  callbacks : action_callback_spec list;
  positional : action_field_spec list;
  keywords : action_field_spec list;
}

type compilers = {
  compile_expr : Value.t -> Value.t;
  compile_json_value : Value.t -> Value.t;
  normalize_literal_value : Value.t -> Value.t;
}

let action_field_kind_of_mechanism config = function
  | mechanism when mechanism = config.string_mechanism -> Some ActionString
  | mechanism when mechanism = config.expr_mechanism -> Some ActionExpr
  | mechanism when mechanism = config.json_mechanism -> Some ActionJson
  | mechanism when mechanism = config.literal_mechanism -> Some ActionLiteral
  | mechanism when mechanism = config.string_list_mechanism ->
      Some ActionStringList
  | _ -> None

let scalar_string = Eval_slot.scalar_string
let keyword key = VKeyword key
let field key value = (keyword (":" ^ key), value)
let object_value entries = VMap entries

let normalize_name name =
  if String.length name > 0 && name.[0] = ':' then
    String.sub name 1 (String.length name - 1)
  else name

let lookup_assoc entries key = List.assoc_opt key entries

let rec drop count values =
  if count <= 0 then values
  else match values with [] -> [] | _ :: rest -> drop (count - 1) rest

let path_segment = function
  | VString value -> Some value
  | VInt value -> Some (string_of_int value)
  | VFloat value -> Some (string_of_float value)
  | VBool true -> Some "true"
  | VBool false -> Some "false"
  | VKeyword name | VSymbol name -> Some (normalize_name name)
  | _ -> None

let keyword_form = function
  | VList (head :: _) | VVector (head :: _) -> (
      match scalar_string head with
      | Some name -> String.length name > 0 && name.[0] = ':'
      | None -> false)
  | _ -> false

let compile_keyword_list items =
  let rec loop positional keywords = function
    | [] -> (List.rev positional, List.rev keywords)
    | ((VList (head :: values) | VVector (head :: values)) as item) :: rest
      when keyword_form item -> (
        match scalar_string head with
        | Some name ->
            let value =
              match values with
              | [] -> VBool true
              | [ value ] -> value
              | values -> VList values
            in
            loop positional ((normalize_name name, value) :: keywords) rest
        | None -> loop (item :: positional) keywords rest)
    | item :: rest -> loop (item :: positional) keywords rest
  in
  loop [] [] items

let rec event_value compilers action_tags action =
  match action with
  | VNil -> VNil
  | VVector values ->
      VList (List.map (compile_action compilers action_tags) values)
  | value -> compile_action compilers action_tags value

and compile_action_field_value compilers (spec : action_field_spec) value =
  match spec.kind with
  | ActionString ->
      Option.map
        (fun value -> field spec.field (VString value))
        (path_segment value)
  | ActionExpr -> Some (field spec.field (compilers.compile_expr value))
  | ActionJson -> Some (field spec.field (compilers.compile_json_value value))
  | ActionLiteral ->
      Some (field spec.field (compilers.normalize_literal_value value))
  | ActionStringList ->
      let values =
        match value with
        | VVector values | VList values -> List.filter_map path_segment values
        | value -> List.filter_map path_segment [ value ]
      in
      Some
        (field spec.field
           (VList (List.map (fun value -> VString value) values)))

and compile_action_field_optional compilers (spec : action_field_spec) value =
  match compile_action_field_value compilers spec value with
  | Some entry -> Some (Some entry)
  | None when spec.optional -> Some None
  | None -> None

and compile_positional_action_field compilers positional index
    (spec : action_field_spec) =
  match spec.kind with
  | ActionStringList ->
      let values =
        match List.nth_opt positional index with
        | Some (VVector values) -> List.filter_map path_segment values
        | Some _ | None ->
            positional |> drop index |> List.filter_map path_segment
      in
      if values <> [] || spec.optional then
        Some
          (Some
             (field spec.field
                (VList (List.map (fun value -> VString value) values))))
      else None
  | _ -> (
      match List.nth_opt positional index with
      | Some value -> compile_action_field_optional compilers spec value
      | None when spec.optional -> Some None
      | None -> None)

and compile_keyword_action_field compilers keywords (spec : action_field_spec) =
  match lookup_assoc keywords spec.input_name with
  | Some value -> compile_action_field_optional compilers spec value
  | None when spec.optional -> Some None
  | None -> None

and compile_action compilers action_specs expr =
  match expr with
  | VList (head :: items) -> (
      match scalar_string head |> Option.map normalize_name with
      | None -> VNil
      | Some head -> (
          let positional, keywords = compile_keyword_list items in
          let action_spec = lookup_assoc action_specs head in
          let generic_action (action_spec : action_spec) =
            let positional_fields =
              action_spec.positional
              |> List.mapi
                   (compile_positional_action_field compilers positional)
            in
            let keyword_fields =
              action_spec.keywords
              |> List.map (compile_keyword_action_field compilers keywords)
            in
            if
              List.exists Option.is_none positional_fields
              || List.exists Option.is_none keyword_fields
            then None
            else
              let callback_entries =
                action_spec.callbacks
                |> List.filter_map (fun (callback : action_callback_spec) ->
                    match lookup_assoc keywords callback.input_name with
                    | Some callback_value ->
                        Some
                          (field callback.field
                             (event_value compilers action_specs callback_value))
                    | None -> None)
              in
              Some
                (object_value
                   (callback_entries
                   @ field action_spec.discriminator_field
                       (VString action_spec.tag)
                     :: List.filter_map
                          (function
                            | Some (Some entry) -> Some entry
                            | Some None | None -> None)
                          (positional_fields @ keyword_fields)))
          in
          match action_spec with
          | Some action_spec -> (
              match generic_action action_spec with
              | Some value -> value
              | None -> VNil)
          | _ -> VNil))
  | _ -> VNil
