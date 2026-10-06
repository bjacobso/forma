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
  eval_required_builtin :
    Env.t -> string -> Reader.expr list -> (value, diagnostic list) result;
  current_lookup_declaration : unit -> (string -> value option) option;
  current_environment : unit -> Env.t option;
}

let diagnostic = Eval_common.diagnostic
let scalar_string = Eval_slot.scalar_string
let slot_values = Eval_slot.slot_values

module Util = Eval_meta_util

let eval ctx env op args =
  let eval_keyword_pairs env name args =
    let rec loop acc = function
      | [] -> Ok (List.rev acc)
      | key :: value :: rest -> (
          match (ctx.eval_expr env key, ctx.eval_expr env value) with
          | Ok (VKeyword key), Ok value ->
              loop ((VKeyword key, value) :: acc) rest
          | Ok (VString key), Ok value ->
              loop ((VString key, value) :: acc) rest
          | Ok (VSymbol key), Ok value ->
              loop ((VString key, value) :: acc) rest
          | Ok _, Ok _ ->
              Error
                [
                  diagnostic "eval/keyword-args"
                    (name ^ " expects keyword/value argument pairs.");
                ]
          | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
      | [ _ ] ->
          Error
            [
              diagnostic "eval/arity"
                (name ^ " expects keyword/value argument pairs.");
            ]
    in
    loop [] args
  in
  let eval_bindings_empty _env = function
    | [] -> Ok (VMap [])
    | _ ->
        Error [ diagnostic "eval/arity" "bindings/empty expects no arguments." ]
  in
  let eval_bindings_of env args =
    match ctx.eval_all env args with
    | Error _ as error -> error
    | Ok pairs ->
        let pair_entry = function
          | VList [ name; typ ] | VVector [ name; typ ] -> (
              match scalar_string name with
              | Some name -> Some (VString name, typ)
              | None -> None)
          | _ -> None
        in
        Ok (VMap (List.filter_map pair_entry pairs))
  in
  let eval_bindings_merge env args =
    ctx.eval_required_builtin env "merge" args
  in
  let eval_bindings_when env = function
    | [ condition; payload ] -> (
        match ctx.eval_expr env condition with
        | Error _ as error -> error
        | Ok (VBool false) | Ok VNil -> eval_bindings_empty env []
        | Ok _ -> ctx.eval_expr env payload)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "bindings/when expects a condition and binding map.";
          ]
  in
  let eval_bindings_from_declaration env = function
    | [ name; typ ] -> (
        match (ctx.eval_expr env name, ctx.eval_expr env typ) with
        | Ok name, Ok typ -> (
            match scalar_string name with
            | Some name -> Ok (VMap [ (VString name, typ) ])
            | None ->
                Error
                  [
                    diagnostic "eval/type"
                      "bindings/from-declaration expects a symbolic name.";
                  ])
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "bindings/from-declaration expects name and type.";
          ]
  in
  let eval_bindings_from_fields env = function
    | [ prefix; fields ] -> (
        match (ctx.eval_expr env prefix, ctx.eval_expr env fields) with
        | Ok prefix, Ok fields -> (
            match scalar_string prefix with
            | None ->
                Error
                  [
                    diagnostic "eval/type"
                      "bindings/from-fields expects a symbolic prefix.";
                  ]
            | Some prefix ->
                Ok (VMap (Util.binding_entries_from_fields prefix fields)))
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "bindings/from-fields expects a prefix and field list.";
          ]
  in
  let eval_bindings_scoped env args = eval_bindings_merge env args in
  let eval_type_unknown _env = function
    | [] -> Ok (Util.type_name_value "Any")
    | _ ->
        Error [ diagnostic "eval/arity" "type/unknown expects no arguments." ]
  in
  let eval_type_constant env = function
    | [ typ ] -> (
        match ctx.eval_expr env typ with
        | Ok typ -> (
            match scalar_string typ with
            | Some name -> Ok (Util.type_name_value name)
            | None ->
                Error
                  [
                    diagnostic "eval/type"
                      "type/constant expects a symbolic type name.";
                  ])
        | Error _ as error -> error)
    | _ -> Error [ diagnostic "eval/arity" "type/constant expects one type." ]
  in
  let eval_type_list env = function
    | [ typ ] -> (
        match ctx.eval_expr env typ with
        | Ok typ -> Ok (Util.type_value "type-list" [ (VKeyword ":item", typ) ])
        | Error _ as error -> error)
    | _ -> Error [ diagnostic "eval/arity" "type/list expects one type." ]
  in
  let eval_type_vector env = function
    | [ typ ] -> (
        match ctx.eval_expr env typ with
        | Ok typ ->
            Ok (Util.type_value "type-vector" [ (VKeyword ":item", typ) ])
        | Error _ as error -> error)
    | _ -> Error [ diagnostic "eval/arity" "type/vector expects one type." ]
  in
  let eval_type_ref env = function
    | [ name ] -> (
        match ctx.eval_expr env name with
        | Ok name -> (
            match scalar_string name with
            | Some name ->
                Ok
                  (Util.type_value "type-ref"
                     [ (VKeyword ":name", VString name) ])
            | None ->
                Error
                  [
                    diagnostic "eval/type"
                      "type/ref expects a symbolic type reference name.";
                  ])
        | Error _ as error -> error)
    | _ -> Error [ diagnostic "eval/arity" "type/ref expects one type name." ]
  in
  let eval_type_record env args =
    match ctx.eval_all env args with
    | Error _ as error -> error
    | Ok fields -> Ok (Util.type_record_value fields)
  in
  let eval_type_project_row env = function
    | [ row; fields ] -> (
        match (ctx.eval_expr env row, ctx.eval_expr env fields) with
        | Ok row, Ok fields -> Ok (Util.project_type_value row fields)
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "type/project-row expects a row type and field list.";
          ]
  in
  let eval_diag_error env args =
    match eval_keyword_pairs env "diag/error" args with
    | Error _ as error -> error
    | Ok entries -> Ok (Util.diag_value "error" entries)
  in
  let eval_diag_concat env args =
    match ctx.eval_all env args with
    | Error _ as error -> error
    | Ok values ->
        let rec loop acc = function
          | [] -> Ok (VList (List.rev acc))
          | VList values :: rest | VVector values :: rest ->
              loop (List.rev_append values acc) rest
          | VNil :: rest -> loop acc rest
          | value :: rest -> loop (value :: acc) rest
        in
        loop [] values
  in
  let eval_diag_require_slot env = function
    | [ input; slot ] -> (
        match (ctx.eval_expr env input, ctx.eval_expr env slot) with
        | Ok input, Ok slot -> (
            match slot_values input slot with
            | _ :: _ -> Ok (VList [])
            | [] ->
                let slot_name =
                  match scalar_string slot with
                  | Some name -> Util.normalize_slot_name name
                  | None -> "slot"
                in
                Ok
                  (VList
                     [
                       Util.diag_value "error"
                         [
                           (VKeyword ":slot", VString slot_name);
                           ( VKeyword ":message",
                             VString ("Missing required slot :" ^ slot_name) );
                         ];
                     ]))
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "diag/require-slot expects input and slot arguments.";
          ]
  in
  let eval_diag_member_of env name args =
    match ctx.eval_all env args with
    | Error _ as error -> error
    | Ok values -> (
        let value, allowed =
          match values with
          | [ value; allowed ] -> (value, allowed)
          | [ _; value; allowed ] -> (value, allowed)
          | _ -> (VNil, VNil)
        in
        match values with
        | [ _; _ ] | [ _; _; _ ] ->
            Ok (Util.membership_diagnostics value allowed)
        | _ ->
            Error
              [
                diagnostic "eval/arity"
                  (name ^ " expects value and allowed-values arguments.");
              ])
  in
  let eval_construct_object env name args =
    match eval_keyword_pairs env name args with
    | Error _ as error -> error
    | Ok entries -> Ok (VMap entries)
  in
  let eval_validate_query_select_fields _env = function
    | [ _input ] -> Ok (VList [])
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "meta/validate-query-select-fields expects input.";
          ]
  in
  let eval_query_select_fields env = function
    | [ input ] -> (
        match ctx.eval_expr env input with
        | Ok input -> (
            match slot_values input (VKeyword ":select") with
            | [ VVector values ] | [ VList values ] -> Ok (VVector values)
            | values -> Ok (VVector values))
        | Error _ as error -> error)
    | _ ->
        Error
          [ diagnostic "eval/arity" "meta/query-select-fields expects input." ]
  in
  let eval_compile_expr_record env = function
    | [ expr ] -> ctx.eval_expr env expr
    | _ ->
        Error
          [ diagnostic "eval/arity" "view/compile-expr-record expects expr." ]
  in
  let eval_compile_descriptor_tree env args =
    let env=Env.extend (Env.visible_bindings env)
      (Option.value ~default:env (ctx.current_environment ())) in
    let registry_for hosted_dsl_name =
      Eval_meta_protocol_metadata.protocol_registries env
      |> List.find_opt (fun registry ->
          registry.Eval_meta_protocol_metadata.header.hosted_dsl_name
          = hosted_dsl_name)
    in
    match args with
    | [ hosted_dsl_name; layout_expr ] -> (
        match ctx.eval_expr env hosted_dsl_name with
        | Error _ as error -> error
        | Ok hosted_dsl_name -> (
            match Option.bind (scalar_string hosted_dsl_name) registry_for with
            | None -> Ok VNil
            | Some registry -> (
                match
                  Eval_meta_protocol_runtime.eval
                    Eval_meta_protocol_runtime.{ eval_expr = ctx.eval_expr }
                    env registry.header.compile_layout_tree_op [ layout_expr ]
                with
                | Error _ as error -> error
                | Ok (Some value) -> Ok value
                | Ok None -> Ok VNil)))
    | [ hosted_dsl_name; component_extension; layout_expr ] -> (
        match ctx.eval_expr env hosted_dsl_name with
        | Error _ as error -> error
        | Ok hosted_dsl_name -> (
            match Option.bind (scalar_string hosted_dsl_name) registry_for with
            | None -> Ok VNil
            | Some registry -> (
                match
                  Eval_meta_protocol_runtime.eval
                    Eval_meta_protocol_runtime.{ eval_expr = ctx.eval_expr }
                    env registry.header.compile_layout_tree_op
                    [ component_extension; layout_expr ]
                with
                | Error _ as error -> error
                | Ok (Some value) -> Ok value
                | Ok None -> Ok VNil)))
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "meta/compile-descriptor-tree expects hosted DSL and layout.";
          ]
  in
  let eval_construct_declaration env args =
    match eval_keyword_pairs env "construct/declaration" args with
    | Error _ as error -> error
    | Ok entries -> Ok (VMap entries)
  in
  let eval_construct_summary env args =
    match eval_keyword_pairs env "construct/summary" args with
    | Error _ as error -> error
    | Ok entries -> Ok (VMap entries)
  in
  let eval_construct_assoc env = function
    | [ object_expr; key; value ] -> (
        match
          ( ctx.eval_expr env object_expr,
            ctx.eval_expr env key,
            ctx.eval_expr env value )
        with
        | Ok (VMap entries), Ok key, Ok value ->
            let filtered =
              List.filter
                (fun (entry_key, _) -> not (Value.equal entry_key key))
                entries
            in
            Ok (VMap ((key, value) :: filtered))
        | Ok _, Ok _, Ok _ ->
            Error
              [
                diagnostic "eval/expected-map"
                  "construct/assoc expects a construct object.";
              ]
        | Error diagnostics, _, _
        | _, Error diagnostics, _
        | _, _, Error diagnostics ->
            Error diagnostics)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "construct/assoc expects an object, key, and value.";
          ]
  in
  let eval_construct_from_descriptor env args =
    match eval_keyword_pairs env "construct/from-descriptor" args with
    | Error _ as error -> error
    | Ok entries -> (
        let lookup =
          Util.lookup_runtime_form_option ctx.current_lookup_declaration env
        in
        let input = List.assoc_opt (VKeyword ":input") entries in
        let normalized =
          match List.assoc_opt (VKeyword ":normalized") entries with
          | Some normalized -> Some normalized
          | None ->
              Option.map (Util.normalized_input_for_construction ~lookup) input
        in
        let descriptor =
          match List.assoc_opt (VKeyword ":descriptor") entries with
          | Some descriptor -> Descriptor.form_of_descriptor "" descriptor
          | None ->
              Option.bind input (fun input ->
                  let normalized =
                    Option.value
                      ~default:
                        (Util.normalized_input_for_construction ~lookup input)
                      normalized
                  in
                  Util.descriptor_form_for_construction ~lookup normalized)
        in
        match (descriptor, normalized) with
        | Some descriptor, Some normalized ->
            Ok (Util.construct_from_form ~lookup descriptor normalized)
        | _ ->
            Error
              [
                diagnostic "eval/arity"
                  "construct/from-descriptor expects :input or :normalized, \
                   and a descriptor must be present explicitly or on the \
                   normalized input.";
              ])
  in
  let some result = Result.map (fun value -> Some value) result in
  match op with
  | "bindings/empty" -> some (eval_bindings_empty env args)
  | "bindings/of" -> some (eval_bindings_of env args)
  | "bindings/merge" -> some (eval_bindings_merge env args)
  | "bindings/when" -> some (eval_bindings_when env args)
  | "bindings/from-declaration" ->
      some (eval_bindings_from_declaration env args)
  | "bindings/from-fields" -> some (eval_bindings_from_fields env args)
  | "bindings/scoped" -> some (eval_bindings_scoped env args)
  | "type/unknown" -> some (eval_type_unknown env args)
  | "type/constant" -> some (eval_type_constant env args)
  | "type/list" -> some (eval_type_list env args)
  | "type/vector" -> some (eval_type_vector env args)
  | "type/ref" -> some (eval_type_ref env args)
  | "type/record" -> some (eval_type_record env args)
  | "type/project-row" -> some (eval_type_project_row env args)
  | "diag/error" -> some (eval_diag_error env args)
  | "diag/concat" -> some (eval_diag_concat env args)
  | "diag/require-slot" -> some (eval_diag_require_slot env args)
  | "diag/member-of" | "diag/one-of" -> some (eval_diag_member_of env op args)
  | "construct/object" -> some (eval_construct_object env op args)
  | "construct/query" -> some (eval_construct_object env op args)
  | "construct/declaration" -> some (eval_construct_declaration env args)
  | "construct/summary" -> some (eval_construct_summary env args)
  | "construct/assoc" -> some (eval_construct_assoc env args)
  | "construct/from-descriptor" ->
      some (eval_construct_from_descriptor env args)
  | "meta/query-select-fields" -> some (eval_query_select_fields env args)
  | "meta/validate-query-select-fields" ->
      some (eval_validate_query_select_fields env args)
  | "view/compile-expr-record" -> some (eval_compile_expr_record env args)
  | "meta/compile-descriptor-tree" ->
      some (eval_compile_descriptor_tree env args)
  | _ ->
      Eval_meta_protocol_runtime.eval
        Eval_meta_protocol_runtime.{ eval_expr = ctx.eval_expr }
        env op args
