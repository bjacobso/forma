open Mechanics_artifact_payload
open Mechanics_value_json

(* FunctionDef, ValueDef, and LayerDef payloads; mirrors functionDeclaration
   and layerDeclaration in packages/ts/src/mechanics/artifact.ts. *)

let failed expr code message =
  Error [ diagnostic ~span:(Ast.expr_span expr) code message ]

let ( let* ) = Result.bind

let strings names = Ir_json.Array (List.map (fun name -> Ir_json.String name) names)

let rec map_result f = function
  | [] -> Ok []
  | item :: rest ->
      let* item = f item in
      let* rest = map_result f rest in
      Ok (item :: rest)

let is_effect_type = function
  | Ir_json.Object entries -> List.assoc_opt "kind" entries = Some (Ir_json.String "Effect")
  | _ -> false

let function_payload ~source_id expr name signature value_expr =
  match value_expr with
  | Ast.List (_, Ast.Symbol (_, "fn") :: (Ast.Vector (_, params) as params_expr) :: (_ :: _ as body))
    -> (
      match signature with
      | Ast.List (_, Ast.Symbol (_, "->") :: (_ :: _ as items)) ->
          let inputs = List.rev (List.tl (List.rev items)) in
          if List.length inputs <> List.length params then
            failed params_expr "artifact/function"
              (Printf.sprintf
                 "function signature declares %d parameter(s) but (fn ...) binds %d."
                 (List.length inputs) (List.length params))
          else
            let param (param, input) =
              match scalar_name param with
              | None -> failed param "artifact/function" "function parameters must be symbolic names."
              | Some param_name ->
                  let* type_json = type_expr_to_json input in
                  Ok (Ir_json.Object [ ("name", Ir_json.String param_name); ("type", type_json) ])
            in
            let* params = map_result param (List.combine params inputs) in
            let* returns = type_expr_to_json (List.hd (List.rev items)) in
            if is_effect_type returns then
              failed expr "artifact/function"
                (name
               ^ " returns an Effect; write it with __operation so its body is an effect \
                  program.")
            else (
              match body with
              | [ body ] ->
                  Ok
                    ( "FunctionDef",
                      obj "FunctionDef"
                        [
                          ("name", Ir_json.String name);
                          ("params", Ir_json.Array params);
                          ("returns", returns);
                          ("body", value_json source_id body);
                        ] )
              | _ ->
                  failed value_expr "artifact/function"
                    "function bodies must be a single value expression.")
      | _ ->
          failed signature "artifact/function" "function signature must be (-> Input... Output).")
  | Ast.List (_, Ast.Symbol (_, "fn") :: _) ->
      failed value_expr "artifact/function" "typed define expects (fn [params...] body)."
  | _ ->
      let* type_json = type_expr_to_json signature in
      Ok
        ( "ValueDef",
          obj "ValueDef"
            [
              ("name", Ir_json.String name);
              ("type", type_json);
              ("value", value_json source_id value_expr);
            ] )

let layer_type_json ~source_id = function
  | Ast.List
      ( _,
        [ Ast.Symbol (_, "Layer"); Ast.Vector (_, provides); Ast.Vector (_, errors);
          Ast.Vector (_, requirements) ] ) as expr ->
      let* provides = symbolic_set_to_json "provides" provides in
      let* errors = symbolic_set_to_json "errors" errors in
      let* requirements = symbolic_set_to_json "requirements" requirements in
      Ok
        (obj "Layer"
           [
             ("provides", strings provides);
             ("errors", strings errors);
             ("requirements", strings requirements);
             ("span", source_json source_id expr);
           ])
  | expr ->
      failed expr "artifact/layer-type"
        "Layer type expects (Layer [Provides...] [Errors...] [Requirements...])."

let rec layer_expr_json ~source_id expr =
  let span = ("span", source_json source_id expr) in
  match (expr, sym_name expr) with
  | _, Some name -> Ok (obj "LayerRef" [ ("name", Ir_json.String name); span ])
  | Ast.List (_, head :: (_ :: _ as operands)), None -> (
      let* operands = map_result (layer_expr_json ~source_id) operands in
      match sym_name head with
      | Some "layer-merge" -> Ok (obj "LayerMerge" [ ("layers", Ir_json.Array operands); span ])
      | Some (("layer-provide" | "layer-provide-merge") as head) -> (
          match operands with
          | layer :: (_ :: _ as dependencies) ->
              Ok
                (obj
                   (if head = "layer-provide" then "LayerProvide" else "LayerProvideMerge")
                   [ ("layer", layer); ("dependencies", Ir_json.Array dependencies); span ])
          | _ ->
              failed expr "artifact/layer"
                (head ^ " expects a layer and at least one dependency layer."))
      | head ->
          failed expr "artifact/layer"
            ("Unknown layer combinator " ^ Option.value head ~default:"?" ^ "."))
  | _ ->
      failed expr "artifact/layer"
        "Expected a layer name or (layer-merge|layer-provide|layer-provide-merge ...)."

let unit_effect =
  obj "Effect"
    [
      ("success", obj "Primitive" [ ("name", Ir_json.String "Unit") ]);
      ("errors", Ir_json.Array []);
      ("requirements", Ir_json.Array []);
    ]

let layer_method_json context method_expr =
  match method_expr with
  | Ast.List (_, name_expr :: Ast.Vector (_, params) :: (_ :: _ as body)) -> (
      match sym_name name_expr with
      | None -> failed name_expr "artifact/layer" "layer methods require a method name."
      | Some name ->
          let param param =
            match scalar_name param with
            | Some param -> Ok (Ir_json.String param)
            | None ->
                failed param "artifact/layer" "layer method parameters must be symbolic names."
          in
          let* params = map_result param params in
          Ok
            (Ir_json.Object
               [
                 ("name", Ir_json.String name);
                 ("params", Ir_json.Array params);
                 ("body", Mechanics_effect_body_json.body_forms_json context body);
                 ("span", source_json context.source_id method_expr);
               ]))
  | _ -> failed method_expr "artifact/layer" "layer methods must be (name [params...] body)."

let service_layer_json context layer_name sections =
  let section (service, setup, methods) = function
    | Ast.List (_, keyword :: rest) as section -> (
        match (sym_name keyword, rest) with
        | Some ":provides", [ service_expr ] when Option.is_some (sym_name service_expr) ->
            Ok (sym_name service_expr, setup, methods)
        | Some ":provides", _ ->
            failed section "artifact/layer" "(:provides Service) names exactly one service."
        | Some ":setup", [ (Ast.Vector _ as bindings) ] ->
            Ok (service, Mechanics_effect_body_json.bindings_json context bindings, methods)
        | Some ":setup", _ ->
            failed section "artifact/layer"
              "(:setup [name effect ...]) expects one binding vector."
        | Some ":methods", method_exprs ->
            let* layer_methods = map_result (layer_method_json context) method_exprs in
            Ok (service, setup, methods @ layer_methods)
        | keyword, _ ->
            failed section "artifact/layer"
              ("Unknown layer section " ^ Option.value keyword ~default:"?"
             ^ "; expected :provides, :setup, or :methods."))
    | _ -> Ok (service, setup, methods)
  in
  let rec loop state = function
    | [] -> Ok state
    | item :: rest ->
        let* state = section state item in
        loop state rest
  in
  let* service, setup, methods = loop (None, [], []) sections in
  match (context_diagnostics context, service) with
  | (_ :: _ as diagnostics), _ -> Error diagnostics
  | [], None ->
      Error
        [
          diagnostic
            ?span:(match sections with first :: _ -> Some (Ast.expr_span first) | [] -> None)
            "artifact/layer"
            ("Layer " ^ layer_name
           ^ " implements a service and needs a (:provides Service) section.");
        ]
  | [], Some service ->
      Ok
        (obj "Service"
           [
             ("service", Ir_json.String service);
             ("setup", Ir_json.Array setup);
             ("methods", Ir_json.Array methods);
           ])

let is_section_list = function
  | Ast.List (_, head :: _) -> is_keyword_expr head
  | _ -> false

let layer_payload ~source_id ~service_effects ~operation_effects expr name signature sections =
  let* signature =
    match signature with
    | None -> Ok []
    | Some signature ->
        let* signature = layer_type_json ~source_id signature in
        Ok [ ("signature", signature) ]
  in
  let* implementation =
    if List.for_all is_section_list sections then
      service_layer_json
        (make_context ~source_id ~service_effects ~operation_effects unit_effect)
        name sections
    else
      match sections with
      | [ layer ] ->
          let* layer = layer_expr_json ~source_id layer in
          Ok (obj "Compose" [ ("layer", layer) ])
      | _ -> failed expr "artifact/layer" "a composed layer is a single layer expression."
  in
  Ok
    (obj "LayerDef"
       ((("name", Ir_json.String name) :: signature) @ [ ("implementation", implementation) ]))
