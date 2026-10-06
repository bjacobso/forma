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
let declaration_args = Eval_slot.declaration_args
let declaration_name = Eval_slot.declaration_name

module Schema = Eval_http_schema
module Http_ir = Http_ir

let schema_decl (ctx : context) env args =
  Schema.schema_decl Schema.{ eval_expr = ctx.eval_expr } env args

let error_decl (ctx : context) env args =
  Schema.error_decl Schema.{ eval_expr = ctx.eval_expr } env args

let path_params path =
  let len = String.length path in
  let rec find_close i =
    if i >= len then None
    else if path.[i] = '}' then Some i
    else find_close (i + 1)
  in
  let rec loop acc i =
    if i >= len then List.rev acc
    else if path.[i] = '{' then
      match find_close (i + 1) with
      | Some close when close > i + 1 ->
          let name = String.sub path (i + 1) (close - i - 1) in
          loop (name :: acc) (close + 1)
      | Some close -> loop acc (close + 1)
      | None -> List.rev acc
    else loop acc (i + 1)
  in
  loop [] 0

let param_form_to_ir = function
  | VList (VSymbol "param" :: name :: schema :: _)
  | VVector (VSymbol "param" :: name :: schema :: _)
  | VList (name :: schema :: _)
  | VVector (name :: schema :: _) -> (
      match (scalar_string name, Schema.schema_expr_to_ir schema) with
      | Some name, Ok schema -> Ok (name, Http_ir.{ name; schema })
      | None, Ok _ ->
          Error
            [
              diagnostic "http/param"
                "Path param declaration expects a symbolic name.";
            ]
      | _, Error diagnostics -> Error diagnostics)
  | _ ->
      Error
        [
          diagnostic "http/param"
            "Path param declaration expects (param name Schema).";
        ]

let params_to_ir params =
  let rec loop names values = function
    | [] -> Ok (List.rev names, List.rev values)
    | param :: rest -> (
        match param_form_to_ir param with
        | Ok (name, value) -> loop (name :: names) (value :: values) rest
        | Error _ as error -> error)
  in
  loop [] [] params

let endpoint_form_to_ir declared_params = function
  | VList (VSymbol "endpoint" :: name_value :: clauses)
  | VVector (VSymbol "endpoint" :: name_value :: clauses) -> (
      match scalar_string name_value with
      | None ->
          Error
            [
              diagnostic "http/endpoint"
                "endpoint expects a symbolic endpoint name.";
            ]
      | Some name -> (
          let input =
            Descriptor.application_values "endpoint" (name_value :: clauses)
          in
          let method_value = Schema.first_slot_value input "method" in
          let path_value = Schema.first_slot_value input "path" in
          let method_name =
            match scalar_string method_value with
            | Some value -> value
            | None -> ""
          in
          let path =
            match scalar_string path_value with
            | Some value -> value
            | None -> ""
          in
          let undeclared =
            path_params path
            |> List.filter (fun param ->
                not (List.exists (( = ) param) declared_params))
          in
          if undeclared <> [] then
            Error
              [
                diagnostic "http/undeclared-path-param"
                  (Printf.sprintf
                     "Endpoint %S path references undeclared path param(s): %s."
                     name
                     (String.concat ", " undeclared));
              ]
          else
            let payload =
              match Schema.first_slot_value input "payload" with
              | VNil -> Ok None
              | value ->
                  Schema.schema_expr_to_ir value |> Result.map Option.some
            in
            let query_fields = Schema.all_slot_values input "query" in
            let query =
              if query_fields = [] then Ok None
              else
                Schema.schema_fields_to_ir query_fields
                |> Result.map (fun fields -> Some (Http_ir.Struct fields))
            in
            let success =
              match Schema.first_slot_value input "success" with
              | VNil ->
                  Error
                    [
                      diagnostic "http/success"
                        "endpoint expects a (:success Schema) slot.";
                    ]
              | value -> Schema.schema_expr_to_ir value
            in
            let rec compile_errors acc = function
              | [] -> Ok (List.rev acc)
              | value :: rest -> (
                  match Schema.schema_expr_to_ir value with
                  | Ok value -> compile_errors (value :: acc) rest
                  | Error _ as error -> error)
            in
            let errors =
              compile_errors [] (Schema.all_slot_values input "errors")
            in
            match (payload, query, success, errors) with
            | Ok payload, Ok query, Ok success, Ok errors ->
                Ok
                  Http_ir.
                    {
                      name;
                      method_ = method_name;
                      path;
                      payload;
                      query;
                      success;
                      errors;
                    }
            | Error diagnostics, _, _, _
            | _, Error diagnostics, _, _
            | _, _, Error diagnostics, _
            | _, _, _, Error diagnostics ->
                Error diagnostics))
  | _ ->
      Error
        [
          diagnostic "http/endpoint"
            "define-api-group children must be endpoint forms.";
        ]

let api_group_endpoints input =
  let args =
    match declaration_args input with [] -> [] | _name :: clauses -> clauses
  in
  List.filter
    (function
      | VList (VSymbol "endpoint" :: _) | VVector (VSymbol "endpoint" :: _) ->
          true
      | _ -> false)
    args

let api_group_decl ctx env = function
  | [ input_expr ] -> (
      match ctx.eval_expr env input_expr with
      | Error _ as error -> error
      | Ok input -> (
          match declaration_name input with
          | None ->
              Error
                [
                  diagnostic "http/api-group-name"
                    "define-api-group expects a group name.";
                ]
          | Some name -> (
              match
                params_to_ir (Schema.all_slot_values input "path-params")
              with
              | Error _ as error -> error
              | Ok (param_names, path_params) -> (
                  let rec compile_endpoints acc = function
                    | [] -> Ok (List.rev acc)
                    | endpoint :: rest -> (
                        match endpoint_form_to_ir param_names endpoint with
                        | Ok endpoint ->
                            compile_endpoints (endpoint :: acc) rest
                        | Error _ as error -> error)
                  in
                  match compile_endpoints [] (api_group_endpoints input) with
                  | Error _ as error -> error
                  | Ok endpoints ->
                      let group =
                        {
                          Http_ir.name;
                          path_params;
                          endpoints;
                          handlers = [];
                          annotations = Schema.annotation_entries input [];
                        }
                      in
                      Ok
                        (Http_ir.http_api_payload_value ~name ~groups:[ group ])
                  ))))
  | _ ->
      Error
        [
          diagnostic "eval/arity"
            "http/api-group-decl expects one declaration input.";
        ]
