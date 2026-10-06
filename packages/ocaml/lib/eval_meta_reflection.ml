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
  eval_all : Env.t -> Reader.expr list -> (value list, diagnostic list) result;
}

type check_expr_handler =
  value -> value -> value -> (value, diagnostic list) result

type infer_expr_handler = value -> value -> (value, diagnostic list) result
type lookup_declaration_handler = string -> value option

type runtime = {
  current_check_expr : unit -> check_expr_handler option;
  current_infer_expr : unit -> infer_expr_handler option;
  current_lookup_declaration : unit -> lookup_declaration_handler option;
}

let diagnostic = Eval_common.diagnostic
let scalar_string = Eval_slot.scalar_string
let declaration_name = Eval_slot.declaration_name
let string_list_value = Eval_slot.string_list_value
let declaration_form = Eval_slot.declaration_form
let positional_arg = Eval_slot.positional_arg

module Util = Eval_meta_util

let eval ctx runtime env op args =
  let lookup_form_option env name =
    Util.lookup_runtime_form_option runtime.current_lookup_declaration env name
  in
  let eval_meta_declaration_name env = function
    | [ input ] -> (
        match ctx.eval_expr env input with
        | Ok input -> (
            match declaration_name input with
            | Some name -> Ok (Some (VString name))
            | None -> Ok (Some VNil))
        | Error _ as error -> error)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "meta/declaration-name expects one input argument.";
          ]
  in
  let eval_meta_form_name env = function
    | [ input ] -> (
        match ctx.eval_expr env input with
        | Ok input -> (
            match declaration_form input with
            | Some form -> Ok (Some (VString form))
            | None -> Ok (Some VNil))
        | Error _ as error -> error)
    | _ -> Error [ diagnostic "eval/arity" "meta/form-name expects one input." ]
  in
  let eval_meta_normalized_form env = function
    | [ input ] -> (
        match ctx.eval_expr env input with
        | Ok input ->
            Ok
              (Some
                 (Eval_slot.normalized_form_with_lookup
                    ~lookup:(lookup_form_option env) input))
        | Error _ as error -> error)
    | _ ->
        Error
          [ diagnostic "eval/arity" "meta/normalized-form expects one input." ]
  in
  let eval_meta_descriptor env = function
    | [ input ] -> (
        match ctx.eval_expr env input with
        | Error _ as error -> error
        | Ok input ->
            Ok
              (Some
                 (Util.descriptor_for_input ~lookup:(lookup_form_option env)
                    input)))
    | _ ->
        Error [ diagnostic "eval/arity" "meta/descriptor expects one input." ]
  in
  let eval_meta_descriptor_extension env = function
    | [ input; extension_key ] -> (
        match (ctx.eval_expr env input, ctx.eval_expr env extension_key) with
        | Ok input, Ok extension_key -> (
            match scalar_string extension_key with
            | None -> Ok (Some VNil)
            | Some extension_key ->
                let lookup declaration_name =
                  lookup_form_option env declaration_name
                in
                Ok
                  (Some
                     (Option.value ~default:VNil
                        (Util.descriptor_extension_for_input ~lookup
                           ~extension_key input))))
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "meta/descriptor-extension expects input and extension key.";
          ]
  in
  let eval_meta_semantic_env _env = function
    | [ _input ] -> Ok (Some VNil)
    | _ ->
        Error [ diagnostic "eval/arity" "meta/semantic-env expects one input." ]
  in
  let eval_meta_lookup_declaration env = function
    | values -> (
        let name_expr =
          match values with
          | [ name ] -> Some name
          | [ _input; name ] -> Some name
          | _ -> None
        in
        match name_expr with
        | None ->
            Error
              [
                diagnostic "eval/arity"
                  "meta/lookup-declaration expects input and declaration name.";
              ]
        | Some name -> (
            match ctx.eval_expr env name with
            | Error _ as error -> error
            | Ok value -> (
                match scalar_string value with
                | None -> Ok (Some VNil)
                | Some name ->
                    Ok
                      (Some
                         (Option.value ~default:VNil
                            (Util.lookup_runtime_declaration
                               runtime.current_lookup_declaration env name))))))
  in
  let eval_meta_declaration_kind env = function
    | [ declaration ] -> (
        match ctx.eval_expr env declaration with
        | Ok declaration -> (
            let lookup declaration_name =
              lookup_form_option env declaration_name
            in
            match Util.declaration_kind_name_for ~lookup declaration with
            | Some kind -> Ok (Some (VString kind))
            | None -> Ok (Some VNil))
        | Error _ as error -> error)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "meta/declaration-kind expects a declaration.";
          ]
  in
  let eval_meta_declaration_type env = function
    | [ declaration ] -> (
        match ctx.eval_expr env declaration with
        | Ok declaration -> (
            let lookup declaration_name =
              lookup_form_option env declaration_name
            in
            match Util.declaration_type_value_for ~lookup declaration with
            | Some typ -> Ok (Some typ)
            | None -> Ok (Some VNil))
        | Error _ as error -> error)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "meta/declaration-type expects a declaration.";
          ]
  in
  let eval_meta_declaration_field env = function
    | [ declaration; field_name ] -> (
        match (ctx.eval_expr env declaration, ctx.eval_expr env field_name) with
        | Ok declaration, Ok field_name -> (
            match scalar_string field_name with
            | None -> Ok (Some VNil)
            | Some field_name ->
                let lookup declaration_name =
                  lookup_form_option env declaration_name
                in
                Util.declaration_field_for ~lookup declaration field_name
                |> Option.value ~default:VNil
                |> fun value -> Ok (Some value))
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "meta/declaration-field expects declaration and field name.";
          ]
  in
  let eval_meta_declaration_fields env = function
    | [ declaration ] -> (
        match ctx.eval_expr env declaration with
        | Ok declaration ->
            let lookup declaration_name =
              lookup_form_option env declaration_name
            in
            Ok (Some (VList (Util.declaration_fields_for ~lookup declaration)))
        | Error _ as error -> error)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "meta/declaration-fields expects a declaration.";
          ]
  in
  let eval_meta_project_type env = function
    | [ declaration; fields ] -> (
        match (ctx.eval_expr env declaration, ctx.eval_expr env fields) with
        | Ok declaration, Ok fields ->
            let lookup declaration_name =
              lookup_form_option env declaration_name
            in
            Ok
              (Some
                 (Util.projected_declaration_type_for ~lookup declaration fields))
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "meta/project-type expects declaration and field list.";
          ]
  in
  let eval_meta_slot_value env name = function
    | [ input; slot ] -> (
        match (ctx.eval_expr env input, ctx.eval_expr env slot) with
        | Ok input, Ok slot ->
            let lookup declaration_name =
              lookup_form_option env declaration_name
            in
            Ok (Some (Eval_slot.slot_value_with_lookup ~lookup input slot))
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              (Printf.sprintf "%s expects input and slot arguments." name);
          ]
  in
  let eval_meta_slot_string env name args =
    match eval_meta_slot_value env name args with
    | Error _ as error -> error
    | Ok (Some value) -> (
        match scalar_string value with
        | Some value -> Ok (Some (VString value))
        | None -> Ok (Some value))
    | Ok None -> Ok None
  in
  let eval_meta_slot_string_list env = function
    | [ input; slot ] -> (
        match (ctx.eval_expr env input, ctx.eval_expr env slot) with
        | Ok input, Ok slot ->
            let lookup declaration_name =
              lookup_form_option env declaration_name
            in
            Ok
              (Some
                 (string_list_value
                    (Eval_slot.slot_value_with_lookup ~lookup input slot)))
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "meta/slot-string-list expects input and slot arguments.";
          ]
  in
  let eval_meta_slot_values env = function
    | [ input; slot ] -> (
        match (ctx.eval_expr env input, ctx.eval_expr env slot) with
        | Ok input, Ok slot ->
            let lookup declaration_name =
              lookup_form_option env declaration_name
            in
            Ok
              (Some
                 (VList (Eval_slot.slot_values_with_lookup ~lookup input slot)))
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "meta/slot-values expects input and slot arguments.";
          ]
  in
  let eval_meta_slot_ref env = function
    | [ input; slot; kind ] -> (
        match
          ( ctx.eval_expr env input,
            ctx.eval_expr env slot,
            ctx.eval_expr env kind )
        with
        | Ok input, Ok slot, Ok kind -> (
            let lookup declaration_name =
              lookup_form_option env declaration_name
            in
            match
              ( scalar_string
                  (Eval_slot.slot_value_with_lookup ~lookup input slot),
                scalar_string kind )
            with
            | Some name, Some kind ->
                Ok
                  (Some
                     (VMap
                        [
                          (VKeyword ":kind", VString kind);
                          (VKeyword ":name", VString name);
                        ]))
            | _ -> Ok (Some VNil))
        | Error diagnostics, _, _
        | _, Error diagnostics, _
        | _, _, Error diagnostics ->
            Error diagnostics)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "meta/slot-ref expects input, slot, and kind arguments.";
          ]
  in
  let eval_meta_child_forms env = function
    | [ input; slot ] -> (
        match (ctx.eval_expr env input, ctx.eval_expr env slot) with
        | Ok input, Ok slot ->
            let lookup declaration_name =
              lookup_form_option env declaration_name
            in
            Ok
              (Some
                 (VList (Eval_slot.child_forms_with_lookup ~lookup input slot)))
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "meta/child-forms expects input and slot arguments.";
          ]
  in
  let eval_meta_identifier env = function
    | [ input; name ] -> (
        match (ctx.eval_expr env input, ctx.eval_expr env name) with
        | Ok input, Ok name ->
            let lookup declaration_name =
              lookup_form_option env declaration_name
            in
            let value =
              Eval_slot.identifier_value_with_lookup ~lookup input name
            in
            Ok
              (Some
                 (match scalar_string value with
                 | Some value -> VString value
                 | None -> value))
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "meta/identifier expects input and identifier name arguments.";
          ]
  in
  let eval_meta_positional env name = function
    | [ input; index ] -> (
        match (ctx.eval_expr env input, ctx.eval_expr env index) with
        | Ok input, Ok (VInt index) -> Ok (Some (positional_arg input index))
        | Ok _, Ok _ ->
            Error
              [
                diagnostic "eval/expected-int"
                  (name ^ " expects an integer index.");
              ]
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              (name ^ " expects input and index arguments.");
          ]
  in
  let eval_meta_expr_assignable_to env args =
    match ctx.eval_all env args with
    | Ok [ input; expr; typ ] -> (
        match runtime.current_check_expr () with
        | None ->
            Error
              [
                diagnostic "meta/check-expr-unavailable"
                  "meta/expr-assignable-to? is only available during \
                   descriptor typechecking.";
              ]
        | Some check_expr -> (
            match check_expr input expr typ with
            | Ok _ -> Ok (Some (VBool true))
            | Error _ -> Ok (Some (VBool false))))
    | Ok _ ->
        Error
          [
            diagnostic "eval/arity"
              "meta/expr-assignable-to? expects input, expression, and type.";
          ]
    | Error _ as error -> error
  in
  let eval_meta_check_expr env args =
    match ctx.eval_all env args with
    | Ok [ input; expr; typ ] -> (
        match runtime.current_check_expr () with
        | None ->
            Error
              [
                diagnostic "meta/check-expr-unavailable"
                  "meta/check-expr is only available during descriptor \
                   typechecking.";
              ]
        | Some check_expr -> check_expr input expr typ |> Result.map Option.some
        )
    | Ok _ ->
        Error
          [
            diagnostic "eval/arity"
              "meta/check-expr expects input, expression, and type.";
          ]
    | Error _ as error -> error
  in
  let eval_meta_infer_expr_type env args =
    match ctx.eval_all env args with
    | Ok [ input; expr ] -> (
        match runtime.current_infer_expr () with
        | None ->
            Error
              [
                diagnostic "meta/infer-expr-unavailable"
                  "meta/infer-expr-type is only available during descriptor \
                   typechecking.";
              ]
        | Some infer_expr -> infer_expr input expr |> Result.map Option.some)
    | Ok _ ->
        Error
          [
            diagnostic "eval/arity"
              "meta/infer-expr-type expects input and expression.";
          ]
    | Error _ as error -> error
  in
  let eval_meta_loc _env = function
    | [ _input ] -> Ok (Some VNil)
    | _ ->
        Error [ diagnostic "eval/arity" "meta/loc expects one input argument." ]
  in
  match op with
  | "meta/declaration-name" -> eval_meta_declaration_name env args
  | "meta/descriptor" -> eval_meta_descriptor env args
  | "meta/descriptor-extension" -> eval_meta_descriptor_extension env args
  | "meta/form-name" -> eval_meta_form_name env args
  | "meta/normalized-form" -> eval_meta_normalized_form env args
  | "meta/semantic-env" -> eval_meta_semantic_env env args
  | "meta/lookup-declaration" -> eval_meta_lookup_declaration env args
  | "meta/declaration-kind" -> eval_meta_declaration_kind env args
  | "meta/declaration-type" -> eval_meta_declaration_type env args
  | "meta/declaration-field" -> eval_meta_declaration_field env args
  | "meta/declaration-fields" -> eval_meta_declaration_fields env args
  | "meta/project-type" -> eval_meta_project_type env args
  | "meta/slot-symbol" | "meta/slot-string" -> eval_meta_slot_string env op args
  | "meta/slot-values" -> eval_meta_slot_values env args
  | "meta/slot-string-list" -> eval_meta_slot_string_list env args
  | "meta/slot-value" | "meta/slot-expr" | "meta/slot-runtime-expr" ->
      eval_meta_slot_value env op args
  | "meta/slot-ref" -> eval_meta_slot_ref env args
  | "meta/child-forms" -> eval_meta_child_forms env args
  | "meta/identifier" -> eval_meta_identifier env args
  | "meta/positional-arg" | "meta/positional-scalar" ->
      eval_meta_positional env op args
  | "meta/expr-assignable-to?" -> eval_meta_expr_assignable_to env args
  | "meta/check-expr" -> eval_meta_check_expr env args
  | "meta/infer-expr-type" -> eval_meta_infer_expr_type env args
  | "meta/loc" -> eval_meta_loc env args
  | _ -> Ok None
