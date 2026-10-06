open Mechanics_artifact_payload

let method_params_to_json = function
  | Ast.Vector (_, params) ->
      let rec loop acc = function
        | [] -> Ok (List.rev acc)
        | name :: type_expr :: rest -> (
          match (scalar_name name, type_expr_to_json type_expr) with
          | Some name, Ok type_json ->
              loop
                (Ir_json.Object
                   [ ("name", Ir_json.String name); ("type", type_json) ]
                :: acc)
                rest
          | None, _ ->
              Error
                [
                  diagnostic ~span:(Ast.expr_span name) "artifact/service-method"
                    "service method params require symbolic names.";
                ]
          | _, (Error _ as error) -> error)
        | bad :: [] ->
            Error
              [
                diagnostic ~span:(Ast.expr_span bad) "artifact/service-method"
                  "service method params must be [name Type ...] pairs.";
              ]
      in
      loop [] params
  | bad ->
      Error
        [
          diagnostic ~span:(Ast.expr_span bad) "artifact/service-method"
            "service method params must be [name Type ...] pairs.";
        ]

let rec method_to_json service_name = function
  | Ast.List (s,[n;params;result;Ast.Keyword (_,":value")]) ->
      method_to_json service_name (Ast.List (s,[n;params;result])) |> Result.map (function Ir_json.Object pairs -> Ir_json.Object (pairs @ ["value",Ir_json.Bool true]) | value -> value)
  | Ast.List (_, [ Ast.Symbol (_, method_name); params_expr; return_expr ]) -> (
    match method_params_to_json params_expr with
    | Error _ as error -> error
    | Ok params -> (
      let operation_requirement = service_name ^ "." ^ method_name in
      match effect_type_to_json return_expr (Some operation_requirement) with
      | Error _ as error -> error
      | Ok effect_json ->
          Ok
            (Ir_json.Object
               [
                 ("name", Ir_json.String method_name);
                 ("params", Ir_json.Array params);
                 ("effect", effect_json);
               ])))
  | bad ->
      Error
        [
          diagnostic ~span:(Ast.expr_span bad) "artifact/service-method"
            "service methods must be (name [param Type ...] ReturnEffect).";
        ]
let methods_to_json service_name methods =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | method_expr :: rest -> (
      match method_to_json service_name method_expr with
      | Error _ as error -> error
      | Ok method_json -> loop (method_json :: acc) rest)
  in
  loop [] methods
let rec expr_to_payload_json expr =
  let obj kind entries = Ir_json.Object (("kind", Ir_json.String kind) :: entries) in
  match expr with
  | Ast.Nil _ -> obj "Symbol" [ ("name", Ir_json.String "nil") ]
  | Ast.Bool (_, value) -> obj "Bool" [ ("value", Ir_json.Bool value) ]
  | Ast.Int (_, value) -> obj "Number" [ ("value", Ir_json.Int value) ]
  | Ast.Float (_, value) -> obj "Number" [ ("value", Ir_json.Float value) ]
  | Ast.String (_, value) -> obj "String" [ ("value", Ir_json.String value) ]
  | Ast.Symbol (_, name) | Ast.Keyword (_, name) ->
      obj "Symbol" [ ("name", Ir_json.String name) ]
  | Ast.List (_, items) | Ast.Vector (_, items) ->
      let kind = match expr with Ast.List _ -> "List" | _ -> "Vector" in
      obj kind [ ("items", Ir_json.Array (List.map expr_to_payload_json items)) ]
  | Ast.Map (_, entries) ->
      let entry (key, value) =
        Ir_json.Object
          [ ("key", expr_to_payload_json key); ("value", expr_to_payload_json value) ]
      in
      obj "Map" [ ("entries", Ir_json.Array (List.map entry entries)) ]
let operation_signatures exprs =
  List.fold_left
    (fun acc -> function
      | Ast.List
          ( _,
            [
              (Ast.Symbol (_, ":") | Ast.Keyword (_, ":"));
              Ast.Symbol (_, name);
              signature_expr;
            ] )
        ->
          (name, signature_expr) :: acc
      | _ -> acc)
    [] exprs

let operation_signature_to_json signature params_expr =
  match (signature, params_expr) with
  | Ast.List (_, Ast.Symbol (_,"Effect") :: _) as effect, Ast.Vector (_,[]) -> effect_type_to_json effect None |> Result.map (fun effect -> [],effect)
  | Ast.List (_, Ast.Symbol (_, "->") :: signature_items), Ast.Vector (_, params)
    when signature_items <> [] ->
      let input_types = List.rev (List.tl (List.rev signature_items)) in
      let effect_expr = List.hd (List.rev signature_items) in
      if List.length input_types <> List.length params then
        Error
          [
            diagnostic ~span:(Ast.expr_span params_expr) "artifact/effect"
              "operation signature arity must match __operation parameters.";
          ]
      else
        let rec params_loop acc params input_types =
          match (params, input_types) with
          | [], [] -> Ok (List.rev acc)
          | param :: params_rest, input :: inputs_rest -> (
            match (scalar_name param, type_expr_to_json input) with
            | Some name, Ok type_json ->
                params_loop
                  (Ir_json.Object
                     [ ("name", Ir_json.String name); ("type", type_json) ]
                  :: acc)
                  params_rest inputs_rest
            | None, _ ->
                Error
                  [
                    diagnostic ~span:(Ast.expr_span param) "artifact/effect"
                      "operation parameters must be symbolic names.";
                  ]
            | _, (Error _ as error) -> error)
          | _ -> assert false
        in
        (match
           (params_loop [] params input_types, effect_type_to_json effect_expr None)
         with
        | (Error diagnostics, _) | (_, Error diagnostics) -> Error diagnostics
        | (Ok params, Ok effect_json) -> Ok (params, effect_json))
  | _ ->
      Error
        [
          diagnostic ~span:(Ast.expr_span signature) "artifact/effect"
            "operation signature must be (-> Input... (Effect ...)).";
        ]
