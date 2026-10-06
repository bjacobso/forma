let value_keyword key = function
  | Value.VMap entries ->
      List.find_map
        (function
          | Value.VKeyword entry_key, value when entry_key = key -> Some value
          | _ -> None)
        entries
  | _ -> None
let value_text = Descriptor_extension.value_text
let kind value =
  match value_keyword ":kind" value with
  | Some (Value.VString kind) -> Some kind
  | _ -> None
type diagnostic = Descriptor_validation.diagnostic = {
  span : Ast.span option;
  code : string;
  message : string;
}

type typed_child_slot = {
  name : string;
  kind : string;
  typ : Value.t option;
  positional_index : int option;
}

type identifier_spec = { name : string; positional_index : int }
type slot_mode = Value | Expr | Form

type typed_slot = {
  name : string;
  mode : slot_mode;
  many : bool;
  typ : Value.t option;
  aliases : string list;
  child_identifiers : identifier_spec list;
  child_slots : typed_child_slot list;
}

type hooks = {
  bindings : string option;
  construct : string option;
  result_type : string option;
  infer : string option;
  check : string option;
}

type construct_field = { name : string; expr : Value.t; optional : bool }
type declaration_type = Constant of Value.t | Row

type form = {
  name : string;
  clauses : Value.t list;
  identifiers : identifier_spec list;
  extensions : (string * Value.t) list;
  result_type : Value.t option;
  declaration_type : declaration_type option;
  construct_kind : string option;
  construct_fields : construct_field list;
  typed_slots : typed_slot list;
  hooks : hooks;
  constructed_by : string option;
  constructed_child : string option;
}

let validate_form_clauses = Descriptor_validation.validate_form_clauses
let validate_meta_fn_clauses = Descriptor_validation.validate_meta_fn_clauses

let declaration_value kind name clauses =
  Value.VMap
    [
      (Value.VKeyword ":kind", Value.VString kind);
      (Value.VKeyword ":name", Value.VSymbol name);
      ( Value.VKeyword ":clauses",
        Value.VList (List.map Quote.value_of_syntax clauses) );
    ]

let application_value form_name args =
  Value.VMap
    [
      (Value.VKeyword ":kind", Value.VString "declaration");
      (Value.VKeyword ":form", Value.VSymbol form_name);
      (Value.VKeyword ":args", Value.VList (List.map Quote.value_of_syntax args));
    ]

let application_values form_name args =
  Value.VMap
    [
      (Value.VKeyword ":kind", Value.VString "declaration");
      (Value.VKeyword ":form", Value.VSymbol form_name);
      (Value.VKeyword ":args", Value.VList args);
    ]

let validate_application_slots form args =
  let slots =
    form.typed_slots
    |> List.map (fun (slot : typed_slot) ->
         Descriptor_application_validation.{ name = slot.name; aliases = slot.aliases })
  in
  Descriptor_application_validation.validate_slots { name = form.name; slots } args

let is_form_descriptor env name =
  match Env.lookup name env with
  | Some value -> kind value = Some "form"
  | None -> false

let declaration_binding_name = function
  | Reader.Symbol (_, name) :: _ -> Some name
  | Reader.String (_, name) :: _ -> Some name
  | Reader.Keyword (_, name) :: _ -> Some name
  | _ -> None

let meta_fn_body clauses =
  List.find_map
    (function
      | Reader.List (_, Reader.Keyword (_, ":body") :: body) -> Some body
      | _ -> None)
    clauses

let declaration_form value =
  match (value_keyword ":kind" value, value_keyword ":form" value) with
  | Some (Value.VString "declaration"), Some form -> value_text form
  | _ -> None

let hook_clause names = function
  | Value.VList (Value.VKeyword name :: hook :: _)
  | Value.VVector (Value.VKeyword name :: hook :: _)
    when List.mem name names ->
      value_text hook
  | _ -> None

let form_hook clauses names = List.find_map (hook_clause names) clauses

let descriptor_clauses = function
  | descriptor -> (
      match
        (value_keyword ":kind" descriptor, value_keyword ":clauses" descriptor)
      with
      | Some (Value.VString "form"), Some (Value.VList clauses)
      | Some (Value.VString "form"), Some (Value.VVector clauses) ->
          Some clauses
      | _ -> None)

let identifier_spec positional_index = function
  | Value.VList (Value.VSymbol "identifier" :: name :: _kind :: _options)
  | Value.VVector (Value.VSymbol "identifier" :: name :: _kind :: _options) -> (
      match value_text name with
      | Some name -> Some { name; positional_index }
      | None -> None)
  | _ -> None

let identifiers_from_clauses clauses =
  clauses
  |> List.filter_map (function
    | Value.VList (Value.VKeyword ":identifiers" :: identifiers)
    | Value.VVector (Value.VKeyword ":identifiers" :: identifiers) ->
        Some
          (identifiers |> List.mapi identifier_spec
          |> List.filter_map (fun spec -> spec))
    | _ -> None)
  |> List.concat

let constant_result_type = function
  | Value.VList
      [
        Value.VKeyword ":result-type";
        Value.VList [ Value.VSymbol "constant"; typ ];
      ]
  | Value.VVector
      [
        Value.VKeyword ":result-type";
        Value.VVector [ Value.VSymbol "constant"; typ ];
      ] ->
      Some typ
  | _ -> None

let declaration_binding_type = function
  | Value.VList
      (Value.VSymbol "bind" :: Value.VSymbol "bind-declaration-name" :: options)
  | Value.VVector
      (Value.VSymbol "bind" :: Value.VSymbol "bind-declaration-name" :: options)
    ->
      options
      |> List.find_map (function
        | Value.VList [ Value.VKeyword ":type"; typ ]
        | Value.VVector [ Value.VKeyword ":type"; typ ] ->
            Some typ
        | _ -> None)
  | _ -> None

let declaration_binding_result_type = function
  | Value.VList (Value.VKeyword ":bindings" :: bindings)
  | Value.VVector (Value.VKeyword ":bindings" :: bindings) ->
      List.find_map declaration_binding_type bindings
  | _ -> None

let result_type_from_clauses clauses =
  match List.find_map constant_result_type clauses with
  | Some _ as typ -> typ
  | None -> List.find_map declaration_binding_result_type clauses

let static_declaration_type = function
  | Value.VList
      [
        Value.VKeyword ":declaration-type";
        Value.VList [ Value.VSymbol "constant"; typ ];
      ]
  | Value.VVector
      [
        Value.VKeyword ":declaration-type";
        Value.VVector [ Value.VSymbol "constant"; typ ];
      ] ->
      Some (Constant typ)
  | Value.VList
      [
        Value.VKeyword ":declaration-type"; Value.VList [ Value.VSymbol "row" ];
      ]
  | Value.VVector
      [
        Value.VKeyword ":declaration-type";
        Value.VVector [ Value.VSymbol "row" ];
      ] ->
      Some Row
  | _ -> None

let declaration_type_from_clauses clauses =
  match List.find_map static_declaration_type clauses with
  | Some declaration_type -> Some declaration_type
  | None ->
      Option.map (fun typ -> Constant typ) (result_type_from_clauses clauses)

let construct_kind_spec = function
  | Value.VList (Value.VKeyword ":construct" :: specs)
  | Value.VVector (Value.VKeyword ":construct" :: specs) ->
      specs
      |> List.find_map (function
        | Value.VList [ key; value ] | Value.VVector [ key; value ] -> (
            match value_text key with
            | Some "kind" -> value_text value
            | _ -> None)
        | _ -> None)
  | _ -> None

let construct_kind_from_clauses clauses =
  List.find_map construct_kind_spec clauses

let construct_field_spec = function
  | Value.VList (key :: expr :: options) | Value.VVector (key :: expr :: options)
    -> (
      match value_text key with
      | None -> None
      | Some name ->
          let optional =
            options
            |> List.exists (function
              | Value.VList [ Value.VKeyword ":optional"; Value.VBool true ]
              | Value.VVector [ Value.VKeyword ":optional"; Value.VBool true ]
                ->
                  true
              | _ -> false)
          in
          Some { name; expr; optional })
  | _ -> None

let construct_fields_from_clauses clauses =
  clauses
  |> List.filter_map (function
    | Value.VList (Value.VKeyword ":construct" :: specs)
    | Value.VVector (Value.VKeyword ":construct" :: specs) ->
        Some (List.filter_map construct_field_spec specs)
    | _ -> None)
  |> List.concat

let slot_type = function
  | Value.VList [ Value.VKeyword ":type"; typ ]
  | Value.VVector [ Value.VKeyword ":type"; typ ] ->
      Some typ
  | _ -> None

let slot_alias = function
  | Value.VList [ Value.VKeyword ":alias"; alias ]
  | Value.VVector [ Value.VKeyword ":alias"; alias ] ->
      value_text alias
  | _ -> None

let is_positional = function
  | Value.VList [ Value.VKeyword ":positional"; Value.VBool true ]
  | Value.VVector [ Value.VKeyword ":positional"; Value.VBool true ] ->
      true
  | _ -> false

let child_identifier positional_index = function
  | Value.VList (Value.VKeyword ":child-identifier" :: name :: _kind :: _options)
  | Value.VVector
      (Value.VKeyword ":child-identifier" :: name :: _kind :: _options) ->
      Option.map (fun name -> { name; positional_index }) (value_text name)
  | _ -> None

let child_identifiers options =
  options
  |> List.filter_map (function
    | ( Value.VList (Value.VKeyword ":child-identifier" :: _)
      | Value.VVector (Value.VKeyword ":child-identifier" :: _) ) as option ->
        Some option
    | _ -> None)
  |> List.mapi child_identifier |> List.filter_map Fun.id

let child_slot positional_index = function
  | Value.VList (Value.VKeyword ":child-slot" :: name :: kind :: options)
  | Value.VVector (Value.VKeyword ":child-slot" :: name :: kind :: options) -> (
      match (value_text name, value_text kind) with
      | Some name, Some kind ->
          Some
            {
              name;
              kind;
              typ = List.find_map slot_type options;
              positional_index =
                (if List.exists is_positional options then Some positional_index
                 else None);
            }
      | _ -> None)
  | _ -> None

let child_slots options =
  let positional_index = ref (List.length (child_identifiers options)) in
  options
  |> List.filter_map (fun option ->
      match child_slot !positional_index option with
      | Some child ->
          if child.positional_index <> None then incr positional_index;
          Some child
      | None -> None)

let typed_slot = function
  | Value.VList (Value.VSymbol "slot" :: name :: kind :: options)
  | Value.VVector (Value.VSymbol "slot" :: name :: kind :: options) -> (
      match (value_text name, value_text kind) with
      | Some name, Some kind ->
          let mode =
            match kind with "value" -> Value | "form" -> Form | _ -> Expr
          in
          Some
            {
              name;
              mode;
              many = List.exists (function Value.VList [Value.VKeyword ":many"; Value.VBool true] | Value.VVector [Value.VKeyword ":many"; Value.VBool true] -> true | _ -> false) options;
              typ = List.find_map slot_type options;
              aliases = List.filter_map slot_alias options;
              child_identifiers = child_identifiers options;
              child_slots = child_slots options;
            }
      | _ -> None)
  | _ -> None

let typed_slots_from_clauses clauses =
  clauses
  |> List.filter_map (function
    | Value.VList (Value.VKeyword ":slots" :: slots)
    | Value.VVector (Value.VKeyword ":slots" :: slots) ->
        Some (List.filter_map typed_slot slots)
    | _ -> None)
  |> List.concat

let hooks_from_clauses clauses =
  {
    bindings = form_hook clauses [ ":bindings-fn" ];
    construct = form_hook clauses [ ":construct-fn" ];
    result_type = form_hook clauses [ ":result-type-fn" ];
    infer = form_hook clauses [ ":infer-fn"; ":infer" ];
    check = form_hook clauses [ ":check-fn"; ":check" ];
  }

let constructed_by_from_clauses clauses =
  form_hook clauses [ ":constructed-by" ]

let constructed_child_from_clauses clauses =
  let rec option_child = function
    | Value.VKeyword ":child" :: value :: _ -> value_text value
    | _ :: rest -> option_child rest
    | [] -> None
  in
  clauses
  |> List.find_map (function
    | Value.VList (Value.VKeyword ":constructed-by" :: _target :: options)
    | Value.VVector (Value.VKeyword ":constructed-by" :: _target :: options) ->
        option_child options
    | _ -> None)

let metadata_extensions = function
  | Value.VMap entries -> (match Value.lookup_map entries (Value.VKeyword ":extensions") with
      | Some (Value.VMap extensions) -> List.filter_map (fun (key,value) -> match Descriptor_extension.value_text key with Some key -> Some (Descriptor_extension.normalize_name key,value) | None -> None) extensions
      | _ -> [])
  | _ -> []

let form_of_descriptor name descriptor =
  (match descriptor_clauses descriptor with Some clauses -> Some clauses | None -> if metadata_extensions descriptor = [] then None else Some [])
  |> Option.map (fun clauses ->
      {
        name = (match descriptor with Value.VMap fields -> (match Value.lookup_map fields (Value.VKeyword ":descriptor-name") with Some (Value.VString n) -> n | _ -> name) | _ -> name);
        clauses;
        identifiers = identifiers_from_clauses clauses;
        extensions = Descriptor_extension.from_clauses clauses @ metadata_extensions descriptor;
        result_type = result_type_from_clauses clauses;
        declaration_type = declaration_type_from_clauses clauses;
        construct_kind = construct_kind_from_clauses clauses;
        construct_fields = construct_fields_from_clauses clauses;
        typed_slots = typed_slots_from_clauses clauses;
        hooks = hooks_from_clauses clauses;
        constructed_by = constructed_by_from_clauses clauses;
        constructed_child = constructed_child_from_clauses clauses;
      })

let form_with_lookup ~lookup form_name =
  Option.bind (lookup form_name) (form_of_descriptor form_name)

let slot_in_form (form : form) slot_name =
  List.find_opt
    (fun (slot : typed_slot) -> slot.name = slot_name)
    form.typed_slots

let child_identifiers_in_form (form : form) slot_name =
  match slot_in_form form slot_name with
  | Some slot -> slot.child_identifiers
  | None -> []

let child_slots_in_form (form : form) slot_name =
  match slot_in_form form slot_name with
  | Some slot -> slot.child_slots
  | None -> []

let identifier_index_in_form (form : form) identifier_name =
  form.identifiers
  |> List.find_map (fun (identifier : identifier_spec) ->
      if identifier.name = identifier_name then Some identifier.positional_index
      else None)

let extension_in_form (form : form) extension_key =
  Descriptor_extension.find form.extensions extension_key

let extension_in_descriptor descriptor extension_key =
  match form_of_descriptor "" descriptor with
  | Some form -> extension_in_form form extension_key
  | None -> None

let declaration_type_in_descriptor descriptor =
  match form_of_descriptor "" descriptor with
  | Some descriptor -> descriptor.declaration_type
  | None -> None

let construct_kind_in_descriptor descriptor =
  match form_of_descriptor "" descriptor with
  | Some descriptor -> descriptor.construct_kind
  | None -> None

let construct_fields_in_descriptor descriptor =
  match form_of_descriptor "" descriptor with
  | Some descriptor -> descriptor.construct_fields
  | None -> []

let child_identifiers_in_descriptor descriptor slot_name =
  match form_of_descriptor "" descriptor with
  | Some descriptor -> child_identifiers_in_form descriptor slot_name
  | None -> []

let child_slots_in_descriptor descriptor slot_name =
  match form_of_descriptor "" descriptor with
  | Some descriptor -> child_slots_in_form descriptor slot_name
  | None -> []

let identifier_index_in_descriptor descriptor identifier_name =
  match form_of_descriptor "" descriptor with
  | Some descriptor -> identifier_index_in_form descriptor identifier_name
  | None -> None

let metadata_for env form_name =
  match Env.lookup ("__metadata/" ^ form_name) env with
  | Some metadata -> metadata_extensions metadata
  | None -> []

let form env form_name =
  form_with_lookup ~lookup:(fun name -> Env.lookup name env) form_name
  |> Option.map (fun form -> {form with extensions = form.extensions @ metadata_for env form_name})

let forms env =
  let grouped = Hashtbl.create 128 in
  Env.visible_bindings env |> List.iter (fun (name, value) -> if not (String.starts_with ~prefix:"__metadata/" name) then match form_of_descriptor name value with
    | None -> ()
    | Some descriptor -> (match Hashtbl.find_opt grouped descriptor.name with
        | None -> Hashtbl.add grouped descriptor.name descriptor
        | Some previous ->
            let primary = if previous.clauses = [] && kind value = Some "form" then descriptor else previous in
            Hashtbl.replace grouped descriptor.name {primary with extensions = previous.extensions @ descriptor.extensions}));
  Hashtbl.fold (fun _ descriptor acc -> descriptor :: acc) grouped []
  |> List.sort (fun left right -> String.compare left.name right.name)

let typed_slots env form_name =
  match form env form_name with
  | Some descriptor -> descriptor.typed_slots
  | None -> []

let identifiers env form_name =
  match form env form_name with
  | Some descriptor -> descriptor.identifiers
  | None -> []

let identifier_index env form_name identifier_name =
  identifiers env form_name
  |> List.find_map (fun (identifier : identifier_spec) ->
      if identifier.name = identifier_name then Some identifier.positional_index
      else None)

let result_type env form_name =
  match form env form_name with
  | Some descriptor -> descriptor.result_type
  | None -> None

let result_type_hook env form_name =
  match form env form_name with
  | Some descriptor -> descriptor.hooks.result_type
  | None -> None

let declaration_type env form_name =
  match form env form_name with
  | Some descriptor -> descriptor.declaration_type
  | None -> None

let construct_kind env form_name =
  match form env form_name with
  | Some descriptor -> descriptor.construct_kind
  | None -> None

let construct_fields env form_name =
  match form env form_name with
  | Some descriptor -> descriptor.construct_fields
  | None -> []

let infer_hook env form_name =
  match form env form_name with
  | Some descriptor -> descriptor.hooks.infer
  | None -> None

let bindings_hook env form_name =
  match form env form_name with
  | Some descriptor -> descriptor.hooks.bindings
  | None -> None

let check_hook env form_name =
  match form env form_name with
  | Some descriptor -> descriptor.hooks.check
  | None -> None

let construct_hook env form_name =
  match form env form_name with
  | Some descriptor -> descriptor.hooks.construct
  | None -> None
