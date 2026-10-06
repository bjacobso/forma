type field_kind = String | Array | Object

type field_constraint = {
  field : string;
  kind : field_kind option;
  literal : string option;
}

type contract = {
  required_fields : string list;
  field_constraints : field_constraint list;
}

let empty = ({ required_fields = []; field_constraints = [] } : contract)
let field_constraint_field constraint_ = constraint_.field
let field_constraint_kind constraint_ = constraint_.kind
let field_constraint_literal constraint_ = constraint_.literal
let contract_required_fields contract = contract.required_fields
let contract_field_constraints contract = contract.field_constraints

let normalize_name name =
  if String.length name > 0 && name.[0] = ':' then
    String.sub name 1 (String.length name - 1)
  else name

let field_value field = function
  | Value.VMap entries ->
      List.find_map
        (function
          | (Value.VKeyword key | Value.VString key | Value.VSymbol key), value
            when normalize_name key = field ->
              Some value
          | _ -> None)
        entries
  | _ -> None

let payload_value artifact = field_value "payload" artifact

let known_payload_clause_names =
  [
    "contract";
    "required-fields";
    "string-fields";
    "array-fields";
    "object-fields";
    "literal-fields";
  ]

let has_payload_clause value =
  known_payload_clause_names
  |> List.exists (fun field -> Option.is_some (field_value field value))

let payload_contract_value artifact =
  match payload_value artifact with
  | Some payload -> Some payload
  | None -> if has_payload_clause artifact then Some artifact else None

let validate_known_payload_clause form_name = function
  | (Value.VKeyword key | Value.VString key | Value.VSymbol key), _ ->
      let clause = normalize_name key in
      if List.mem clause known_payload_clause_names then Ok ()
      else
        Error
          (Printf.sprintf
             "Unknown descriptor artifact payload clause %S for form %S." clause
             form_name)
  | _ ->
      Error
        (Printf.sprintf
           "Descriptor artifact payload clauses for form %S must use textual \
            clause names."
           form_name)

let validate_known_payload_clauses form_name = function
  | None -> Ok ()
  | Some (Value.VMap entries) ->
      let rec loop = function
        | [] -> Ok ()
        | entry :: rest -> (
            match validate_known_payload_clause form_name entry with
            | Ok () -> loop rest
            | Error _ as error -> error)
      in
      loop entries
  | Some _ ->
      Error
        (Printf.sprintf
           "Descriptor artifact payload for form %S must be a map of clauses."
           form_name)

let payload_contract_descriptor_value form_name name value =
  let clause_entry = function
    | Value.VList
        ((Value.VKeyword key | Value.VString key | Value.VSymbol key) :: values)
    | Value.VVector
        ((Value.VKeyword key | Value.VString key | Value.VSymbol key) :: values)
      ->
        let value =
          match values with [ value ] -> value | values -> Value.VList values
        in
        Ok (Value.VKeyword key, value)
    | _ ->
        Error
          (Printf.sprintf
             "Descriptor artifact payload contract %S for form %S must contain \
              payload clauses with textual clause names."
             name form_name)
  in
  let rec clause_entries acc = function
    | [] -> Ok (Value.VMap (List.rev acc))
    | clause :: rest -> (
        match clause_entry clause with
        | Error _ as error -> error
        | Ok entry -> clause_entries (entry :: acc) rest)
  in
  match value with
  | Value.VMap entries -> (
      match
        ( Value.lookup_map entries (Value.VKeyword ":kind"),
          Value.lookup_map entries (Value.VKeyword ":clauses") )
      with
      | Some (Value.VString "payload-contract"), Some (Value.VList clauses)
      | Some (Value.VString "payload-contract"), Some (Value.VVector clauses) ->
          clause_entries [] clauses
      | _ ->
          Error
            (Printf.sprintf
               "Descriptor artifact payload contract reference %S for form %S \
                must name a __payload-contract declaration."
               name form_name))
  | _ ->
      Error
        (Printf.sprintf
           "Descriptor artifact payload contract reference %S for form %S must \
            name a __payload-contract declaration."
           name form_name)

let payload_contract_name form_name acc value =
  match Descriptor.value_text value with
  | Some name -> (
      match normalize_name name with
      | "" ->
          Error
            (Printf.sprintf
               "Descriptor artifact payload contract reference for form %S \
                must not be empty."
               form_name)
      | name when List.mem name acc ->
          Error
            (Printf.sprintf
               "Descriptor artifact payload contract reference for form %S \
                must not repeat contract %S."
               form_name name)
      | name -> Ok name)
  | None ->
      Error
        (Printf.sprintf
           "Descriptor artifact payload contract reference for form %S must be \
            textual."
           form_name)

let rec payload_contract_names form_name payload =
  match field_value "contract" payload with
  | None -> Ok []
  | Some (Value.VList [] | Value.VVector []) ->
      Error
        (Printf.sprintf
           "Descriptor artifact payload contract reference for form %S must \
            not be empty."
           form_name)
  | Some (Value.VList [ (Value.VList _ as value) ])
  | Some (Value.VList [ (Value.VVector _ as value) ]) ->
      payload_contract_names form_name
        (Value.VMap [ (Value.VKeyword ":contract", value) ])
  | Some (Value.VList values | Value.VVector values) ->
      let rec loop acc = function
        | [] -> Ok (List.rev acc)
        | value :: rest -> (
            match payload_contract_name form_name acc value with
            | Error _ as error -> error
            | Ok name -> loop (name :: acc) rest)
      in
      loop [] values
  | Some value -> (
      match payload_contract_name form_name [] value with
      | Error _ as error -> error
      | Ok name -> Ok [ name ])

let field_name ~clause form_name acc value =
  match Descriptor.value_text value with
  | Some name -> (
      match normalize_name name with
      | "" ->
          Error
            (Printf.sprintf
               "Descriptor artifact payload %s for form %S must not be empty."
               clause form_name)
      | name when List.mem name acc ->
          Error
            (Printf.sprintf
               "Descriptor artifact payload %s for form %S must not repeat \
                field %S."
               clause form_name name)
      | name -> Ok name)
  | None ->
      Error
        (Printf.sprintf
           "Descriptor artifact payload %s for form %S must be textual." clause
           form_name)

let field_name_list ~clause form_name values =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | value :: rest -> (
        match field_name ~clause form_name acc value with
        | Ok name -> loop (name :: acc) rest
        | Error _ as error -> error)
  in
  loop [] values

let field_names_from_value ~clause form_name = function
  | None -> Ok []
  | Some (Value.VList values | Value.VVector values) ->
      field_name_list ~clause form_name values
  | Some value -> (
      match field_name ~clause form_name [] value with
      | Ok field -> Ok [ field ]
      | Error _ ->
          Error
            (Printf.sprintf
               "Descriptor artifact payload %s for form %S must be a textual \
                value or list."
               clause form_name))

let literal_field form_name acc = function
  | Value.VList [ field; literal ] | Value.VVector [ field; literal ] -> (
      match (Descriptor.value_text field, Descriptor.value_text literal) with
      | Some field, Some literal -> (
          match normalize_name field with
          | "" ->
              Error
                (Printf.sprintf
                   "Descriptor artifact payload literal-fields for form %S \
                    must not include an empty field."
                   form_name)
          | field when List.mem field acc ->
              Error
                (Printf.sprintf
                   "Descriptor artifact payload literal-fields for form %S \
                    must not repeat field %S."
                   form_name field)
          | field -> Ok (field, literal))
      | _ ->
          Error
            (Printf.sprintf
               "Descriptor artifact payload literal-fields for form %S must \
                contain textual field and literal values."
               form_name))
  | _ ->
      Error
        (Printf.sprintf
           "Descriptor artifact payload literal-fields for form %S must \
            contain [field literal] entries."
           form_name)

let literal_fields_from_value form_name = function
  | None -> Ok []
  | Some (Value.VList values | Value.VVector values) ->
      let rec loop fields acc = function
        | [] -> Ok (List.rev acc)
        | value :: rest -> (
            match literal_field form_name fields value with
            | Ok (field, literal) ->
                loop (field :: fields) ((field, literal) :: acc) rest
            | Error _ as error -> error)
      in
      loop [] [] values
  | Some _ ->
      Error
        (Printf.sprintf
           "Descriptor artifact payload literal-fields for form %S must be a \
            list."
           form_name)

let literal_constraints fields =
  List.map
    (fun (field, literal) -> { field; kind = None; literal = Some literal })
    fields

let field_kind_name = function
  | String -> "string"
  | Array -> "array"
  | Object -> "object"

let find_kind field constraints =
  constraints
  |> List.find_map (fun constraint_ ->
      match constraint_.kind with
      | Some kind when constraint_.field = field -> Some kind
      | _ -> None)

let add_kind_constraints form_name constraints kind fields =
  let rec loop acc = function
    | [] -> Ok (constraints @ List.rev acc)
    | field :: rest -> (
        match find_kind field constraints with
        | Some previous ->
            Error
              (Printf.sprintf
                 "Descriptor artifact payload field %S for form %S has \
                  conflicting kind constraints %S and %S."
                 field form_name (field_kind_name previous)
                 (field_kind_name kind))
        | None -> loop ({ field; kind = Some kind; literal = None } :: acc) rest
        )
  in
  loop [] fields

let validate_literal_kind_constraints form_name kind_constraints literal_fields
    =
  let rec loop = function
    | [] -> Ok ()
    | (field, _) :: rest -> (
        match find_kind field kind_constraints with
        | Some String | None -> loop rest
        | Some kind ->
            Error
              (Printf.sprintf
                 "Descriptor artifact payload literal field %S for form %S \
                  cannot also be constrained as a %s field."
                 field form_name (field_kind_name kind)))
  in
  loop literal_fields

let kind_constraints form_name string_fields array_fields object_fields =
  match add_kind_constraints form_name [] String string_fields with
  | Error _ as error -> error
  | Ok constraints -> (
      match add_kind_constraints form_name constraints Array array_fields with
      | Error _ as error -> error
      | Ok constraints ->
          add_kind_constraints form_name constraints Object object_fields)

let add_required_fields fields next_fields =
  fields @ List.filter (fun field -> not (List.mem field fields)) next_fields

let same_kind_constraint left right =
  match (left.kind, right.kind) with
  | Some left_kind, Some right_kind -> Some (left_kind = right_kind)
  | _ -> None

let same_literal_constraint left right =
  match (left.literal, right.literal) with
  | Some left_literal, Some right_literal -> Some (left_literal = right_literal)
  | _ -> None

let constraint_conflict form_name left right =
  match same_kind_constraint left right with
  | Some true -> None
  | Some false ->
      Some
        (Printf.sprintf
           "Descriptor artifact payload field %S for form %S has conflicting \
            kind constraints."
           right.field form_name)
  | None -> (
      match same_literal_constraint left right with
      | Some true -> None
      | Some false ->
          Some
            (Printf.sprintf
               "Descriptor artifact payload field %S for form %S has \
                conflicting literal constraints."
               right.field form_name)
      | None -> (
          match (left.kind, left.literal, right.kind, right.literal) with
          | Some (Array as kind), _, _, Some _
          | Some (Object as kind), _, _, Some _ ->
              Some
                (Printf.sprintf
                   "Descriptor artifact payload literal field %S for form %S \
                    cannot also be constrained as a %s field."
                   right.field form_name (field_kind_name kind))
          | _, Some _, Some (Array as kind), _
          | _, Some _, Some (Object as kind), _ ->
              Some
                (Printf.sprintf
                   "Descriptor artifact payload literal field %S for form %S \
                    cannot also be constrained as a %s field."
                   right.field form_name (field_kind_name kind))
          | _ -> None))

let add_field_constraint form_name constraints constraint_ =
  match
    constraints
    |> List.find_map (fun existing ->
        if existing.field <> constraint_.field then None
        else constraint_conflict form_name existing constraint_)
  with
  | Some message -> Error message
  | None ->
      if
        constraints
        |> List.exists (fun existing ->
            existing.field = constraint_.field
            && existing.kind = constraint_.kind
            && existing.literal = constraint_.literal)
      then Ok constraints
      else Ok (constraints @ [ constraint_ ])

let merge_field_constraints form_name left right =
  let rec loop constraints = function
    | [] -> Ok constraints
    | constraint_ :: rest -> (
        match add_field_constraint form_name constraints constraint_ with
        | Error _ as error -> error
        | Ok constraints -> loop constraints rest)
  in
  loop left right

let merge_contracts form_name left right =
  match
    merge_field_constraints form_name left.field_constraints
      right.field_constraints
  with
  | Error _ as error -> error
  | Ok field_constraints ->
      Ok
        {
          required_fields =
            add_required_fields left.required_fields right.required_fields;
          field_constraints;
        }

let merge_contract_list form_name contracts =
  let rec loop acc = function
    | [] -> Ok acc
    | contract :: rest -> (
        match merge_contracts form_name acc contract with
        | Error _ as error -> error
        | Ok acc -> loop acc rest)
  in
  loop empty contracts

let rec contract_of_payload_value env form_name seen payload =
  match validate_known_payload_clauses form_name (Some payload) with
  | Error _ as error -> error
  | Ok () -> (
      match payload_contract_names form_name payload with
      | Error _ as error -> error
      | Ok contract_names -> (
          let inherited_contract =
            let rec loop acc = function
              | [] -> merge_contract_list form_name (List.rev acc)
              | name :: rest -> (
                  match payload_contract_by_name env form_name seen name with
                  | Error _ as error -> error
                  | Ok contract -> loop (contract :: acc) rest)
            in
            loop [] contract_names
          in
          match inherited_contract with
          | Error _ as error -> error
          | Ok inherited_contract -> (
              match
                field_names_from_value ~clause:"required-fields" form_name
                  (field_value "required-fields" payload)
              with
              | Error _ as error -> error
              | Ok required_fields -> (
                  match
                    field_names_from_value ~clause:"string-fields" form_name
                      (field_value "string-fields" payload)
                  with
                  | Error _ as error -> error
                  | Ok string_fields -> (
                      match
                        field_names_from_value ~clause:"array-fields" form_name
                          (field_value "array-fields" payload)
                      with
                      | Error _ as error -> error
                      | Ok array_fields -> (
                          match
                            field_names_from_value ~clause:"object-fields"
                              form_name
                              (field_value "object-fields" payload)
                          with
                          | Error _ as error -> error
                          | Ok object_fields -> (
                              match
                                literal_fields_from_value form_name
                                  (field_value "literal-fields" payload)
                              with
                              | Error _ as error -> error
                              | Ok literal_fields -> (
                                  match
                                    kind_constraints form_name string_fields
                                      array_fields object_fields
                                  with
                                  | Error _ as error -> error
                                  | Ok kind_constraints -> (
                                      match
                                        validate_literal_kind_constraints
                                          form_name kind_constraints
                                          literal_fields
                                      with
                                      | Error _ as error -> error
                                      | Ok () ->
                                          merge_contracts form_name
                                            inherited_contract
                                            {
                                              required_fields;
                                              field_constraints =
                                                kind_constraints
                                                @ literal_constraints
                                                    literal_fields;
                                            })))))))))

and payload_contract_by_name env form_name seen name =
  if List.mem name seen then
    Error
      (Printf.sprintf
         "Descriptor artifact payload contract %S for form %S is recursive."
         name form_name)
  else
    match Env.lookup name env with
    | None ->
        Error
          (Printf.sprintf
             "Unknown descriptor artifact payload contract %S for form %S." name
             form_name)
    | Some value -> (
        match payload_contract_descriptor_value form_name name value with
        | Error _ as error -> error
        | Ok payload ->
            contract_of_payload_value env form_name (name :: seen) payload)

let contract_by_name env name = payload_contract_by_name env name [] name

let contract_of_artifact env (form : Descriptor.form) artifact =
  match payload_contract_value artifact with
  | None -> Ok empty
  | Some payload -> contract_of_payload_value env form.name [] payload

let contract_of_form env (form : Descriptor.form) =
  match Descriptor.extension_in_form form "artifact" with
  | None -> Ok empty
  | Some artifact -> contract_of_artifact env form artifact

let contract env form_name =
  match Descriptor.form env form_name with
  | None -> Ok empty
  | Some form -> contract_of_form env form
