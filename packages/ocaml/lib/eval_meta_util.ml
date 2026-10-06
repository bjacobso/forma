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

let scalar_string = Eval_slot.scalar_string
let declaration_name = Eval_slot.declaration_name
let declaration_form = Eval_slot.declaration_form

let normalize_name name =
  if String.length name > 0 && name.[0] = ':' then
    String.sub name 1 (String.length name - 1)
  else name

let key_string = function
  | VKeyword name | VSymbol name | VString name -> Some (normalize_name name)
  | value -> scalar_string value |> Option.map normalize_name

type declaration_field_spec = { name : string; typ : value }
type record_type_field_spec = { label : string; typ : value }

type reflected_type_spec =
  | Named_type of string
  | Ref_type of string
  | Structured_type of value

type projected_row_type_spec = { row : value; fields : value list }

let type_value kind fields = VMap ((VKeyword ":kind", VString kind) :: fields)

let type_name_value name =
  type_value "type" [ (VKeyword ":name", VString name) ]

let row_type_value name =
  type_value "type-ref" [ (VKeyword ":name", VString ("Row<" ^ name ^ ">")) ]

let string_list = function
  | VList values | VVector values -> List.filter_map scalar_string values
  | value -> Option.to_list (scalar_string value)

let normalize_slot_name name =
  if String.length name > 0 && name.[0] = ':' then
    String.sub name 1 (String.length name - 1)
  else name

let overlay_lookup_option primary fallback name =
  match primary name with Some _ as found -> found | None -> fallback name

let overlay_lookup_value primary fallback name =
  Option.value ~default:VNil (overlay_lookup_option primary fallback name)

let runtime_lookup current_lookup fallback_env =
  match current_lookup () with
  | Some lookup -> lookup
  | None -> fun name -> Env.lookup name fallback_env

let lookup_runtime_value current_lookup fallback_env name =
  Option.value ~default:VNil (runtime_lookup current_lookup fallback_env name)

let lookup_runtime_option current_lookup fallback_env name =
  runtime_lookup current_lookup fallback_env name

let raw_kind_name = Descriptor.kind

let raw_type_value = function
  | VMap entries -> Value.lookup_map entries (VKeyword ":type")
  | _ -> None

let form_descriptor_lookup env name =
  Env.bindings env
  |> List.find_map (fun (binding_name, value) ->
      if binding_name = name && raw_kind_name value = Some "form" then
        Some value
      else None)

let lookup_runtime_form_option current_lookup fallback_env name =
  match current_lookup () with
  | Some lookup -> (
      match lookup name with
      | Some value when raw_kind_name value = Some "form" -> Some value
      | _ -> form_descriptor_lookup fallback_env name)
  | None -> form_descriptor_lookup fallback_env name

let lookup_runtime_declaration current_lookup fallback_env name =
  match lookup_runtime_value current_lookup fallback_env name with
  | declaration when raw_kind_name declaration = Some "declaration" ->
      Some
        (Eval_slot.normalized_form_with_lookup
           ~lookup:(runtime_lookup current_lookup fallback_env)
           declaration)
  | _ -> None

let embedded_descriptor = function
  | VMap entries -> Value.lookup_map entries (VKeyword ":descriptor")
  | _ -> None

let reflected_type_value_of_spec = function
  | Named_type name -> type_name_value name
  | Ref_type name -> type_value "type-ref" [ (VKeyword ":name", VString name) ]
  | Structured_type value -> value

let reflected_type_spec_of_value = function
  | VString name | VSymbol name | VKeyword name -> Some (Named_type name)
  | VMap entries as value -> (
      match Value.lookup_map entries (VKeyword ":kind") with
      | Some (VString "type") -> (
          match
            Option.bind
              (Value.lookup_map entries (VKeyword ":name"))
              scalar_string
          with
          | Some name -> Some (Named_type name)
          | None -> Some (Structured_type value))
      | Some (VString "type-ref") -> (
          match
            Option.bind
              (Value.lookup_map entries (VKeyword ":name"))
              scalar_string
          with
          | Some name -> Some (Ref_type name)
          | None -> Some (Structured_type value))
      | Some _ -> (
          match scalar_string value with
          | Some name -> Some (Named_type name)
          | None -> (
              match
                ( Value.lookup_map entries (VKeyword ":form"),
                  Value.lookup_map entries (VKeyword ":args") )
              with
              | Some form, Some (VList [ arg ])
              | Some form, Some (VVector [ arg ]) -> (
                  match (scalar_string form, scalar_string arg) with
                  | Some "Ref", Some name -> Some (Ref_type name)
                  | _ -> Some (Structured_type value))
              | _ -> Some (Structured_type value)))
      | None -> (
          match
            Option.bind
              (Value.lookup_map entries (VKeyword ":name"))
              scalar_string
          with
          | Some name -> Some (Named_type name)
          | None -> None))
  | value -> (
      match scalar_string value with
      | Some name -> Some (Named_type name)
      | None -> (
          match value with
          | VList (VSymbol "Ref" :: VSymbol name :: _)
          | VVector (VSymbol "Ref" :: VSymbol name :: _) ->
              Some (Ref_type name)
          | value -> Some (Structured_type value)))

let type_value_of_slot_type value =
  reflected_type_spec_of_value value
  |> Option.map reflected_type_value_of_spec
  |> Option.value ~default:value

let reflected_type_value = function
  | value ->
      Option.bind (raw_type_value value) (fun type_value ->
          reflected_type_spec_of_value type_value
          |> Option.map reflected_type_value_of_spec)

let list_value = function
  | VList values | VVector values -> values
  | VNil -> []
  | value -> [ value ]

let descriptor_for_input ~lookup input =
  match Descriptor.kind input with
  | Some "form" -> input
  | _ -> (
      match embedded_descriptor input with
      | Some descriptor -> descriptor
      | None -> (
          match declaration_form input with
          | Some form -> Option.value ~default:VNil (lookup form)
          | None -> VNil))

let descriptor_form_for_input ~lookup input =
  let form_name = Option.value ~default:"" (declaration_form input) in
  match descriptor_for_input ~lookup input with
  | VNil -> None
  | descriptor -> Descriptor.form_of_descriptor form_name descriptor

let declaration_kind_name_for ~lookup declaration =
  match descriptor_form_for_input ~lookup declaration with
  | Some descriptor when descriptor.construct_kind <> None ->
      descriptor.construct_kind
  | _ -> raw_kind_name declaration

let declaration_type_value_for ~lookup declaration =
  match descriptor_form_for_input ~lookup declaration with
  | Some { declaration_type = Some (Descriptor.Constant typ); _ } ->
      Some (type_value_of_slot_type typ)
  | Some { declaration_type = Some Descriptor.Row; _ } -> (
      match declaration_name declaration with
      | Some name -> Some (row_type_value name)
      | None -> Some (type_name_value "Row"))
  | _ -> reflected_type_value declaration

let declaration_field_spec_value { name; typ } =
  VMap [ (VKeyword ":name", VString name); (VKeyword ":type", typ) ]

let declaration_field_spec_of_value = function
  | VMap entries -> (
      match
        ( Option.bind (Value.lookup_map entries (VKeyword ":name")) scalar_string,
          Value.lookup_map entries (VKeyword ":type") )
      with
      | Some name, Some typ -> Some { name; typ }
      | _ -> None)
  | _ -> None

let declaration_field_spec_of_form ~lookup field =
  match
    scalar_string
      (Eval_slot.identifier_value_with_lookup ~lookup field (VKeyword ":name"))
  with
  | None -> None
  | Some name ->
      Some
        {
          name;
          typ =
            type_value_of_slot_type
              (Eval_slot.slot_value field (VKeyword ":type"));
        }

let declaration_field_value ~lookup field =
  declaration_field_spec_of_form ~lookup field
  |> Option.map declaration_field_spec_value

let declaration_fields_for ~lookup declaration =
  declaration |> Eval_slot.normalized_form_with_lookup ~lookup |> fun input ->
  Eval_slot.child_forms_with_lookup ~lookup input (VKeyword ":field")
  |> List.filter_map (declaration_field_value ~lookup)

let declaration_field_name field =
  declaration_field_spec_of_value field
  |> Option.map (fun (field : declaration_field_spec) -> field.name)

let declaration_field_type field =
  declaration_field_spec_of_value field
  |> Option.map (fun (field : declaration_field_spec) -> field.typ)

let declaration_field_for ~lookup declaration field_name =
  declaration_fields_for ~lookup declaration
  |> List.find_opt (function field ->
      declaration_field_name field = Some field_name)

let declaration_fields declaration =
  declaration_fields_for ~lookup:(fun _ -> None) declaration

let binding_entries_from_fields prefix fields =
  let entry field =
    match declaration_field_spec_of_value field with
    | Some ({ name; typ } : declaration_field_spec) ->
        Some (VString (prefix ^ name), typ)
    | None -> None
  in
  List.filter_map entry (list_value fields)

let diag_value severity entries =
  VMap
    ([
       (VKeyword ":kind", VString "Diagnostic");
       (VKeyword ":severity", VString severity);
     ]
    @ entries)

let membership_diagnostics value allowed =
  let allowed_values =
    match allowed with
    | VList values | VVector values -> values
    | VNil -> []
    | value -> [ value ]
  in
  if List.exists (Value.equal value) allowed_values then VList []
  else
    let display =
      match scalar_string value with
      | Some value -> value
      | None -> Value.to_str_part value
    in
    VList
      [
        diag_value "error"
          [
            (VKeyword ":value", value);
            (VKeyword ":allowed", VList allowed_values);
            (VKeyword ":message", VString (display ^ " is not an allowed value"));
          ];
      ]

let record_type_field_value { label; typ } =
  VMap [ (VKeyword ":label", VString label); (VKeyword ":type", typ) ]

let record_type_field_spec_of_value = function
  | VList [ label; typ ] | VVector [ label; typ ] -> (
      match scalar_string label with
      | Some label -> Some { label; typ = type_value_of_slot_type typ }
      | None -> None)
  | VMap entries -> (
      match
        ( Option.bind
            (Value.lookup_map entries (VKeyword ":label"))
            scalar_string,
          Value.lookup_map entries (VKeyword ":type") )
      with
      | Some label, Some typ ->
          Some { label; typ = type_value_of_slot_type typ }
      | _ -> None)
  | _ -> None

let type_record_value fields =
  type_value "type-record"
    [
      ( VKeyword ":fields",
        VList
          (fields
          |> List.filter_map record_type_field_spec_of_value
          |> List.map record_type_field_value) );
    ]

let projected_row_type_value { row; fields } =
  type_value "type-project-row"
    [ (VKeyword ":row", row); (VKeyword ":fields", VList fields) ]

let project_type_value row fields =
  projected_row_type_value
    { row = type_value_of_slot_type row; fields = list_value fields }

let projected_declaration_type_for ~lookup declaration fields =
  match declaration_type_value_for ~lookup declaration with
  | Some row -> project_type_value row fields
  | None -> type_name_value "Any"

let normalized_input_for_construction ~lookup input =
  Eval_slot.normalized_form_with_lookup ~lookup input

let descriptor_form_for_construction ~lookup input =
  descriptor_form_for_input ~lookup input

let descriptor_extension_for_input ~lookup ~extension_key input =
  match descriptor_form_for_input ~lookup input with
  | Some form -> Descriptor.extension_in_form form extension_key
  | None -> None

let extension_spec_of_form ~extension_key decode_extension
    (form : Descriptor.form) =
  match Descriptor.extension_in_form form extension_key with
  | Some extension -> decode_extension extension
  | None -> None

let option_value key = function
  | VMap entries -> Value.lookup_map entries (VKeyword key)
  | _ -> None

let collect_unique_form_specs spec_of_form forms =
  forms
  |> List.fold_left
       (fun specs form ->
         match spec_of_form form with
         | Some (name, spec) when List.assoc_opt name specs = None ->
             (name, spec) :: specs
         | _ -> specs)
       []

let collect_unique_env_specs env spec_of_form =
  Descriptor.forms env |> collect_unique_form_specs spec_of_form

let truthy = Value.truthy

let rec construct_expr ~lookup normalized = function
  | VSymbol "declaration-name" -> (
      match declaration_name normalized with
      | Some name -> VString name
      | None -> VNil)
  | VSymbol "loc" -> VNil
  | VList (VSymbol "or" :: values) | VVector (VSymbol "or" :: values) ->
      values
      |> List.find_map (fun value ->
          let value = construct_expr ~lookup normalized value in
          if truthy value then Some value else None)
      |> Option.value ~default:VNil
  | VList [ VSymbol "identifier"; name ]
  | VVector [ VSymbol "identifier"; name ] ->
      Eval_slot.identifier_value_with_lookup ~lookup normalized name
  | VList [ VSymbol "slot"; name ]
  | VVector [ VSymbol "slot"; name ]
  | VList [ VSymbol "slot-value"; name ]
  | VVector [ VSymbol "slot-value"; name ]
  | VList [ VSymbol "slot-expr"; name ]
  | VVector [ VSymbol "slot-expr"; name ] ->
      Eval_slot.slot_value normalized name
  | VList [ VSymbol "children"; name ] | VVector [ VSymbol "children"; name ] ->
      VList (Eval_slot.child_forms_with_lookup ~lookup normalized name)
  | VList [ VSymbol "identifier-ref"; kind; name ]
  | VVector [ VSymbol "identifier-ref"; kind; name ] -> (
      match
        ( scalar_string kind,
          scalar_string
            (Eval_slot.identifier_value_with_lookup ~lookup normalized name) )
      with
      | Some kind, Some name ->
          VMap
            [
              (VKeyword ":kind", VString kind); (VKeyword ":name", VString name);
            ]
      | _ -> VNil)
  | value -> value

let construct_from_form ~lookup (form : Descriptor.form) normalized =
  let construct_entry (field : Descriptor.construct_field) =
    let value = construct_expr ~lookup normalized field.expr in
    if field.optional && not (truthy value) then None
    else Some (VKeyword (":" ^ field.name), value)
  in
  VMap (List.filter_map construct_entry form.construct_fields)
