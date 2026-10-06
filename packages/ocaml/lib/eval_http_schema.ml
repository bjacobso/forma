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

type diagnostic = Eval_common.diagnostic = {
  span : Ast.span option;
  code : string;
  message : string;
}

type context = {
  eval_expr : Env.t -> Reader.expr -> (value, diagnostic list) result;
}

let diagnostic = Eval_common.diagnostic
let scalar_string = Eval_slot.scalar_string
let declaration_name = Eval_slot.declaration_name
let slot_values = Eval_slot.slot_values

module Http_ir = Http_ir

let primitive_name name =
  match String.lowercase_ascii name with
  | "string" -> Some "String"
  | "int" | "integer" -> Some "Int"
  | "float" -> Some "Float"
  | "number" -> Some "Number"
  | "bool" | "boolean" -> Some "Bool"
  | "bytes" -> Some "Bytes"
  | "uint8array" -> Some "Uint8Array"
  | "json" -> Some "Json"
  | _ -> None

let rec schema_expr_to_ir = function
  | VSymbol name | VString name | VKeyword name -> (
      let name =
        if String.length name > 0 && name.[0] = ':' then
          String.sub name 1 (String.length name - 1)
        else name
      in
      match primitive_name name with
      | Some prim -> Ok (Http_ir.Primitive prim)
      | None -> Ok (Http_ir.Ref name))
  | VList [ VSymbol "Optional"; inner ]
  | VList [ VSymbol "optional"; inner ]
  | VVector [ VSymbol "Optional"; inner ]
  | VVector [ VSymbol "optional"; inner ] -> (
      match schema_expr_to_ir inner with
      | Ok inner -> Ok (Http_ir.Optional inner)
      | Error _ as error -> error)
  | VList [ VSymbol "Array"; inner ]
  | VList [ VSymbol "array"; inner ]
  | VVector [ VSymbol "Array"; inner ]
  | VVector [ VSymbol "array"; inner ] -> (
      match schema_expr_to_ir inner with
      | Ok inner -> Ok (Http_ir.Array inner)
      | Error _ as error -> error)
  | VList [ VSymbol "Ref"; target ] | VVector [ VSymbol "Ref"; target ] -> (
      match scalar_string target with
      | Some target -> Ok (Http_ir.Ref target)
      | None ->
          Error
            [
              diagnostic "http/schema-ref"
                "Ref schema expects a symbolic target.";
            ])
  | VList [ VSymbol "Literal"; value ] | VVector [ VSymbol "Literal"; value ] ->
      Ok (Http_ir.Literal value)
  | value -> (
      match scalar_string value with
      | Some name -> Ok (Http_ir.Ref name)
      | None ->
          Error
            [
              diagnostic "http/schema"
                "Expected a schema symbol or schema expression.";
            ])

let first_slot_value input slot =
  match slot_values input (VKeyword (":" ^ slot)) with
  | [] -> VNil
  | value :: _ -> value

let all_slot_values input slot = slot_values input (VKeyword (":" ^ slot))

let field_form_to_ir = function
  | VList (VSymbol "field" :: name :: schema :: _)
  | VVector (VSymbol "field" :: name :: schema :: _)
  | VList (name :: schema :: _)
  | VVector (name :: schema :: _) -> (
      match (scalar_string name, schema_expr_to_ir schema) with
      | Some name, Ok schema -> Ok Http_ir.{ name; schema }
      | None, Ok _ ->
          Error
            [
              diagnostic "http/field"
                "Field declaration expects a symbolic field name.";
            ]
      | _, Error diagnostics -> Error diagnostics)
  | _ ->
      Error
        [
          diagnostic "http/field"
            "Field declaration expects (field name Schema).";
        ]

let schema_fields_to_ir fields =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | field :: rest -> (
        match field_form_to_ir field with
        | Ok field -> loop (field :: acc) rest
        | Error _ as error -> error)
  in
  loop [] fields

let annotation_entries input extra =
  let optional_slot key =
    match first_slot_value input key with
    | VNil -> None
    | value -> Some (key, value)
  in
  List.filter_map optional_slot [ "identifier"; "doc"; "pattern" ] @ extra

let schema_body_from_decl input =
  match scalar_string (first_slot_value input "kind") with
  | Some kind -> (
      match String.lowercase_ascii kind with
      | "struct" ->
          let fields =
            all_slot_values input "fields" @ all_slot_values input "field"
          in
          schema_fields_to_ir fields
          |> Result.map (fun fields -> Http_ir.Struct fields)
      | "union" ->
          let variants = all_slot_values input "variants" in
          let rec loop acc = function
            | [] -> Ok (List.rev acc)
            | variant :: rest -> (
                match schema_expr_to_ir variant with
                | Ok variant -> loop (variant :: acc) rest
                | Error _ as error -> error)
          in
          loop [] variants
          |> Result.map (fun variants -> Http_ir.Union variants)
      | "array" -> (
          match schema_expr_to_ir (first_slot_value input "items") with
          | Ok item -> Ok (Http_ir.Array item)
          | Error _ as error -> error)
      | "literal" -> Ok (Http_ir.Literal (first_slot_value input "value"))
      | primitive -> (
          match primitive_name primitive with
          | Some prim -> Ok (Http_ir.Primitive prim)
          | None -> Ok (Http_ir.Ref kind)))
  | None ->
      Error
        [
          diagnostic "http/schema-kind"
            "__schema expects a (:kind ...) slot.";
        ]

let apply_schema_modifiers input schema =
  let branded =
    match first_slot_value input "brand" with
    | VNil -> schema
    | brand -> (
        match scalar_string brand with
        | Some brand -> Http_ir.Brand { brand; schema }
        | None -> schema)
  in
  Http_ir.Annotated
    { schema = branded; annotations = annotation_entries input [] }

let schema_decl ctx env = function
  | [ input_expr ] -> (
      match ctx.eval_expr env input_expr with
      | Error _ as error -> error
      | Ok input -> (
          match declaration_name input with
          | None ->
              Error
                [
                  diagnostic "http/schema-name"
                    "__schema expects a schema name.";
                ]
          | Some name -> (
              match schema_body_from_decl input with
              | Error _ as error -> error
              | Ok schema ->
                  Ok
                    (Http_ir.schema_payload_value ~name ~schema_kind:None
                       (apply_schema_modifiers input schema)))))
  | _ ->
      Error
        [
          diagnostic "eval/arity"
            "http/schema-decl expects one declaration input.";
        ]

let error_decl ctx env = function
  | [ input_expr ] -> (
      match ctx.eval_expr env input_expr with
      | Error _ as error -> error
      | Ok input -> (
          match declaration_name input with
          | None ->
              Error
                [ diagnostic "http/error-name" "__error expects a name." ]
          | Some name -> (
              match
                schema_fields_to_ir
                  (all_slot_values input "fields"
                  @ all_slot_values input "field")
              with
              | Error _ as error -> error
              | Ok fields ->
                  let tagged_fields =
                    {
                      Http_ir.name = "_tag";
                      schema = Http_ir.Literal (VString name);
                    }
                    :: fields
                  in
                  let status =
                    match first_slot_value input "status" with
                    | VNil -> VInt 500
                    | value -> value
                  in
                  let schema =
                    Http_ir.Brand
                      { brand = name; schema = Http_ir.Struct tagged_fields }
                  in
                  Ok
                    (Http_ir.schema_payload_value ~name
                       ~schema_kind:(Some "Error")
                       (Http_ir.Annotated
                          {
                            schema;
                            annotations =
                              annotation_entries input [ ("status", status) ];
                          })))))
  | _ ->
      Error
        [
          diagnostic "eval/arity"
            "http/error-decl expects one declaration input.";
        ]
