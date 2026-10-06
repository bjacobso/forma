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
  | VClosure of closure
  | VMacro of closure

and closure = Value.closure = {
  params : string list;
  rest_param : string option;
  body : Ast.expr list;
  env : (string * value) list;
}

let rec scalar_string = function
  | VString value | VSymbol value -> Some value
  | VKeyword value -> Some value
  | VInt value -> Some (string_of_int value)
  | VFloat value -> Some (string_of_float value)
  | VBool value -> Some (string_of_bool value)
  | (VMap entries | VDictionary entries) -> (
      match Value.lookup_map entries (VKeyword ":kind") with
      | Some (VString "variable") -> (
          match Value.lookup_map entries (VKeyword ":name") with
          | Some (VString value) | Some (VSymbol value) | Some (VKeyword value)
            ->
              Some value
          | _ -> None)
      | Some (VString "literal") -> (
          match Value.lookup_map entries (VKeyword ":value") with
          | Some value -> scalar_string value
          | None -> None)
      | _ -> None)
  | _ -> None

let normalize_slot_name name =
  if String.length name > 0 && name.[0] = ':' then
    String.sub name 1 (String.length name - 1)
  else name

let normalized_form_entries = function
  | (VMap entries | VDictionary entries) -> (
      match Value.lookup_map entries (VKeyword ":kind") with
      | Some (VString "normalized-form") -> Some entries
      | _ -> None)
  | _ -> None

let normalized_lookup_map input key =
  Option.bind (normalized_form_entries input) (fun entries ->
      match Value.lookup_map entries (VKeyword key) with
      | Some (VMap values) -> Some values
      | _ -> None)

let declaration_args input =
  match normalized_form_entries input with
  | Some entries -> (
      match Value.lookup_map entries (VKeyword ":args") with
      | Some (VList args) | Some (VVector args) -> args
      | _ -> [])
  | None -> (
      match input with
      | (VMap entries | VDictionary entries) -> (
          match Value.lookup_map entries (VKeyword ":args") with
          | Some (VList args) | Some (VVector args) -> args
          | _ -> [])
      | _ -> [])

let declaration_form = function
  | (VMap entries | VDictionary entries) -> (
      match Value.lookup_map entries (VKeyword ":form") with
      | Some value -> scalar_string value
      | None -> None)
  | _ -> None

let declaration_name input =
  match normalized_form_entries input with
  | Some entries -> (
      match Value.lookup_map entries (VKeyword ":name") with
      | Some value -> scalar_string value
      | None -> None)
  | None -> (
      match declaration_args input with
      | first :: _ -> scalar_string first
      | [] -> None)

let slot_spec_with_lookup ~lookup input slot_name =
  match declaration_form input with
  | Some form_name -> (
      match Descriptor.form_with_lookup ~lookup form_name with
      | Some form -> Descriptor.slot_in_form form slot_name
      | None -> None)
  | None -> None

let slot_values_with_lookup ~lookup input slot =
  let wanted_slot =
    match slot with
    | VKeyword key | VString key | VSymbol key -> Some (normalize_slot_name key)
    | _ -> None
  in
  let slot_key =
    match slot with
    | VKeyword key -> VKeyword key
    | VString key when String.length key > 0 && key.[0] = ':' -> VKeyword key
    | VString key | VSymbol key -> VKeyword (":" ^ key)
    | other -> other
  in
  let slot_spec =
    slot_spec_with_lookup ~lookup input (Option.value ~default:"" wanted_slot)
  in
  let slot_mode =
    Option.map (fun (slot : Descriptor.typed_slot) ->
      if slot.child_identifiers <> [] || slot.child_slots <> [] then Descriptor.Form else slot.mode) slot_spec
  in
  let slot_names =
    match (wanted_slot, slot_spec) with
    | Some wanted_slot, Some slot ->
        wanted_slot :: List.map normalize_slot_name slot.aliases
    | Some wanted_slot, None -> [ wanted_slot ]
    | None, _ -> []
  in
  let slot_matches value =
    match value with
    | VKeyword key | VString key | VSymbol key ->
        List.mem (normalize_slot_name key) slot_names
    | _ -> false
  in
  let normalized_slot_values () =
    Option.bind (normalized_lookup_map input ":slots") (fun entries ->
        List.find_map
          (function
            | VKeyword key, value
              when List.mem (normalize_slot_name key) slot_names -> (
                match value with
                | VList values | VVector values -> Some values
                | VNil -> Some []
                | value -> Some [ value ])
            | _ -> None)
          entries)
  in
  let application_slot_values = function
    | (VMap entries | VDictionary entries) -> (
        match
          ( Value.lookup_map entries (VKeyword ":kind"),
            Value.lookup_map entries (VKeyword ":form"),
            Value.lookup_map entries (VKeyword ":args"),
            wanted_slot )
        with
        | ( Some (VString ("application" | "declaration")),
            Some form,
            Some (VList values),
            Some wanted )
        | ( Some (VString ("application" | "declaration")),
            Some form,
            Some (VVector values),
            Some wanted ) -> (
            match scalar_string form with
            | Some form when normalize_slot_name form = wanted -> (
                match slot_mode with
                | Some Descriptor.Form -> Some [ VMap entries ]
                | _ -> Some values)
            | _ -> None)
        | _ -> None)
    | _ -> None
  in
  let rec loop acc = function
    | [] -> List.rev acc
    | (VList (key :: values) :: rest | VVector (key :: values) :: rest)
      when Value.equal key slot_key || slot_matches key ->
        let next =
          match slot_mode with
          | Some Descriptor.Form -> VList (key :: values) :: acc
          | _ -> List.rev_append values acc
        in
        loop next rest
    | value :: rest -> (
        match application_slot_values value with
        | Some values -> loop (List.rev_append values acc) rest
        | None -> loop acc rest)
  in
  match normalized_slot_values () with
  | Some values -> values
  | None ->
      let args = declaration_args input in
      let clauses =
        match (declaration_name input, args) with
        | Some _, _ :: clauses -> clauses
        | _ -> args
      in
      loop [] clauses

let slot_values input slot =
  slot_values_with_lookup ~lookup:(fun _ -> None) input slot

let string_list_value = function
  | VNil -> VList []
  | VList values | VVector values ->
      VList
        (List.filter_map
           (fun value -> Option.map (fun s -> VString s) (scalar_string value))
           values)
  | value -> (
      match scalar_string value with
      | Some value -> VList [ VString value ]
      | None -> VList [])

let child_identifier_specs_value specs =
  VList
    (List.map
       (fun (spec : Descriptor.identifier_spec) ->
         VMap
           [
             (VKeyword ":name", VString spec.name);
             (VKeyword ":positional-index", VInt spec.positional_index);
           ])
       specs)

let child_slot_specs_value specs =
  VList
    (List.map
       (fun (spec : Descriptor.typed_child_slot) ->
         let positional_index =
           match spec.positional_index with
           | Some positional_index -> VInt positional_index
           | None -> VNil
         in
         let typ = match spec.typ with Some typ -> typ | None -> VNil in
         VMap
           [
             (VKeyword ":name", VString spec.name);
             (VKeyword ":type", typ);
             (VKeyword ":positional-index", positional_index);
           ])
       specs)

let child_identifier_specs ~lookup input slot_name =
  match declaration_form input with
  | Some form_name -> (
      match Descriptor.form_with_lookup ~lookup form_name with
      | Some form -> Descriptor.child_identifiers_in_form form slot_name
      | None -> [])
  | None -> []

let child_slot_specs ~lookup input slot_name =
  match declaration_form input with
  | Some form_name -> (
      match Descriptor.form_with_lookup ~lookup form_name with
      | Some form -> Descriptor.child_slots_in_form form slot_name
      | None -> [])
  | None -> []

let unwrap_single_child_form = function
  | [ VList (VKeyword _ :: values) ]
  | [ VList (VString _ :: values) ]
  | [ VList (VSymbol _ :: values) ]
  | [ VVector values ] ->
      values
  | [ (VMap entries as value) ] -> (
      match
        ( Value.lookup_map entries (VKeyword ":kind"),
          Value.lookup_map entries (VKeyword ":args") )
      with
      | Some (VString ("application" | "declaration")), Some (VList values)
      | Some (VString ("application" | "declaration")), Some (VVector values) ->
          values
      | _ -> [ value ])
  | values -> values

let child_form_args = function
  | VList (VKeyword _ :: values)
  | VList (VString _ :: values)
  | VList (VSymbol _ :: values) ->
      unwrap_single_child_form values
  | VList values | VVector values -> unwrap_single_child_form values
  | (VMap entries | VDictionary entries) -> (
      match
        ( Value.lookup_map entries (VKeyword ":kind"),
          Value.lookup_map entries (VKeyword ":args") )
      with
      | Some (VString ("application" | "declaration")), Some (VList values)
      | Some (VString ("application" | "declaration")), Some (VVector values) ->
          unwrap_single_child_form values
      | _ -> [ VMap entries ])
  | value -> [ value ]

let child_form_value_with_lookup ~lookup input slot_name = function
  | value -> (
      let values = child_form_args value in
      let base = Descriptor.application_values slot_name values in
      let child_identifiers = child_identifier_specs ~lookup input slot_name in
      let child_slots = child_slot_specs ~lookup input slot_name in
      match base with
      | (VMap entries | VDictionary entries) ->
          let entries =
            if child_identifiers = [] then entries
            else
              ( VKeyword ":child-identifiers",
                child_identifier_specs_value child_identifiers )
              :: entries
          in
          let entries =
            if child_slots = [] then entries
            else
              (VKeyword ":child-slots", child_slot_specs_value child_slots)
              :: entries
          in
          VMap entries
      | _ -> base)

let child_form_value input slot_name value =
  child_form_value_with_lookup ~lookup:(fun _ -> None) input slot_name value

let child_forms_with_lookup ~lookup input slot =
  let slot_name =
    match slot with
    | VKeyword key when String.length key > 0 && key.[0] = ':' ->
        String.sub key 1 (String.length key - 1)
    | VKeyword key | VString key | VSymbol key -> key
    | _ -> "child"
  in
  match normalized_lookup_map input ":children" with
  | Some entries -> (
      match
        List.find_map
          (function
            | VKeyword key, value
              when normalize_slot_name key = normalize_slot_name slot_name -> (
                match value with
                | VList values | VVector values -> Some values
                | VNil -> Some []
                | value -> Some [ value ])
            | _ -> None)
          entries
      with
      | Some values -> values
      | None ->
          List.map
            (child_form_value_with_lookup ~lookup input slot_name)
            (slot_values_with_lookup ~lookup input slot))
  | None ->
      List.map
        (child_form_value_with_lookup ~lookup input slot_name)
        (slot_values_with_lookup ~lookup input slot)

let child_forms input slot =
  child_forms_with_lookup ~lookup:(fun _ -> None) input slot

let positional_args input = declaration_args input

let positional_arg input index =
  let args = positional_args input in
  if index < 0 || index >= List.length args then VNil else List.nth args index

let option_map_lookup options key =
  match options with
  | (VMap entries | VDictionary entries) -> Value.lookup_map entries (VKeyword (":" ^ key))
  | _ -> None

let identifier_name = function
  | VKeyword key when String.length key > 0 && key.[0] = ':' ->
      String.sub key 1 (String.length key - 1)
  | VKeyword key | VString key | VSymbol key -> key
  | _ -> ""

let identifier_index_with_lookup ~lookup form wanted =
  match form with
  | Some form_name -> (
      match Descriptor.form_with_lookup ~lookup form_name with
      | Some descriptor -> Descriptor.identifier_index_in_form descriptor wanted
      | None -> None)
  | None -> None

let child_identifier_index input wanted =
  match input with
  | (VMap entries | VDictionary entries) -> (
      match Value.lookup_map entries (VKeyword ":child-identifiers") with
      | Some (VList identifiers) | Some (VVector identifiers) ->
          identifiers
          |> List.find_map (function
            | (VMap entries | VDictionary entries) -> (
                match
                  ( Value.lookup_map entries (VKeyword ":name"),
                    Value.lookup_map entries (VKeyword ":positional-index") )
                with
                | Some name, Some (VInt positional_index) -> (
                    match scalar_string name with
                    | Some name when normalize_slot_name name = wanted ->
                        Some positional_index
                    | _ -> None)
                | _ -> None)
            | _ -> None)
      | _ -> None)
  | _ -> None

let child_slot_index input wanted =
  match input with
  | (VMap entries | VDictionary entries) -> (
      match Value.lookup_map entries (VKeyword ":child-slots") with
      | Some (VList slots) | Some (VVector slots) ->
          slots
          |> List.find_map (function
            | (VMap entries | VDictionary entries) -> (
                match Value.lookup_map entries (VKeyword ":name") with
                | Some name -> (
                    match scalar_string name with
                    | Some name when normalize_slot_name name = wanted ->
                        Some
                          (match
                             Value.lookup_map entries
                               (VKeyword ":positional-index")
                           with
                          | Some (VInt positional_index) ->
                              Some positional_index
                          | _ -> None)
                    | _ -> None)
                | None -> None)
            | _ -> None)
      | _ -> None)
  | _ -> None

let identifier_value_with_lookup ~lookup input name =
  let form = declaration_form input in
  let wanted = identifier_name name |> normalize_slot_name in
  let fallback () =
    let index =
      match child_identifier_index input wanted with
      | Some index -> Some index
      | None -> identifier_index_with_lookup ~lookup form wanted
    in
    match index with
    | Some index ->
        let arguments = declaration_args input |> List.filter (function
          | VList (VKeyword _ :: _) | VVector (VKeyword _ :: _) -> false
          | _ -> true) in
        Option.value ~default:VNil (List.nth_opt arguments index)
    | None -> VNil
  in
  match normalized_lookup_map input ":identifiers" with
  | Some entries -> (
      match
        List.find_map
          (function
            | VKeyword key, value when normalize_slot_name key = wanted ->
                Some value
            | _ -> None)
          entries
      with
      | Some value -> value
      | None -> fallback ())
  | None -> fallback ()

let identifier_value input name =
  identifier_value_with_lookup ~lookup:(fun _ -> None) input name

let slot_value_with_lookup ~lookup input slot =
  match slot_values_with_lookup ~lookup input slot with
  | [] -> (
      let slot_key =
        match slot with
        | VKeyword key when String.length key > 0 && key.[0] = ':' ->
            String.sub key 1 (String.length key - 1)
        | VKeyword key | VString key | VSymbol key -> key
        | _ -> ""
      in
      match child_slot_index input slot_key with
      | Some (Some index) -> positional_arg input index
      | Some None -> (
          match List.rev (positional_args input) with
          | options :: _ -> (
              match option_map_lookup options slot_key with
              | Some value -> value
              | None -> VNil)
          | [] -> VNil)
      | None -> VNil)
  | [ value ] -> value
  | values -> VList values

let slot_value input slot =
  slot_value_with_lookup ~lookup:(fun _ -> None) input slot

let normalized_form_with_lookup ~lookup input =
  match normalized_form_entries input with
  | Some _ -> input
  | None -> (
      match declaration_form input with
      | None -> input
      | Some form_name ->
          let descriptor = lookup form_name in
          let form = Descriptor.form_with_lookup ~lookup form_name in
          let identifier_entries =
            form
            |> Option.map (fun (form : Descriptor.form) ->
                form.identifiers
                |> List.map (fun (identifier : Descriptor.identifier_spec) ->
                    ( VKeyword (":" ^ identifier.name),
                      identifier_value_with_lookup ~lookup input
                        (VKeyword (":" ^ identifier.name)) )))
            |> Option.value ~default:[]
          in
          let slot_entries =
            form
            |> Option.map (fun (form : Descriptor.form) ->
                form.typed_slots
                |> List.map (fun (slot : Descriptor.typed_slot) ->
                    let name = VKeyword (":" ^ slot.name) in
                    (name, VList (slot_values_with_lookup ~lookup input name))))
            |> Option.value ~default:[]
          in
          let child_entries =
            form
            |> Option.map (fun (form : Descriptor.form) ->
                form.typed_slots
                |> List.map (fun (slot : Descriptor.typed_slot) ->
                    let name = VKeyword (":" ^ slot.name) in
                    (name, VList (child_forms_with_lookup ~lookup input name))))
            |> Option.value ~default:[]
          in
          let base =
            [
              (VKeyword ":kind", VString "normalized-form");
              (VKeyword ":form", VSymbol form_name);
              (VKeyword ":args", VList (declaration_args input));
              (VKeyword ":identifiers", VMap identifier_entries);
              (VKeyword ":slots", VMap slot_entries);
              (VKeyword ":children", VMap child_entries);
            ]
          in
          let base =
            match declaration_name input with
            | Some name -> (VKeyword ":name", VString name) :: base
            | None -> base
          in
          let base =
            match descriptor with
            | Some descriptor -> (VKeyword ":descriptor", descriptor) :: base
            | None -> base
          in
          VMap base)

let normalized_form input =
  normalized_form_with_lookup ~lookup:(fun _ -> None) input
