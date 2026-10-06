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

type runtime_invocation = Eval_meta_protocol_assembly.runtime_invocation =
  | Layout_only of string
  | Component_layout
  | Hosted_dsl_component_layout of string

type protocol_runtime_shape =
      Eval_meta_protocol_assembly.protocol_runtime_shape = {
  op_name : string;
  invocations : runtime_invocation list;
}

type protocol_runtime_contract =
      Eval_meta_protocol_assembly.protocol_runtime_contract = {
  registry_env : Eval_meta_protocol_assembly.protocol_registry_env;
  shape : protocol_runtime_shape;
}

type protocol_request = {
  component_extension : string;
  layout_expr : Reader.expr;
}

type protocol_execution_request = {
  context : Eval_meta_protocol_assembly.protocol_context;
  layout_expr : Reader.expr;
}

let diagnostic = Eval_common.diagnostic
let scalar_string = Eval_slot.scalar_string
let normalize_name = Eval_meta_util.normalize_name

let expected_invocation_descriptions (shape : protocol_runtime_shape) =
  List.map
    (function
      | Layout_only _ -> "layout"
      | Component_layout -> "component kind plus layout"
      | Hosted_dsl_component_layout _ ->
          "hosted DSL name plus component kind plus layout")
    shape.invocations

let default_component_extension (shape : protocol_runtime_shape) =
  List.find_map
    (function
      | Layout_only component_extension -> Some component_extension
      | Component_layout | Hosted_dsl_component_layout _ -> None)
    shape.invocations

let expected_hosted_dsl_name (shape : protocol_runtime_shape) =
  List.find_map
    (function
      | Hosted_dsl_component_layout hosted_dsl_name -> Some hosted_dsl_name
      | Layout_only _ | Component_layout -> None)
    shape.invocations

let resolve_hosted_dsl_name ctx env (shape : protocol_runtime_shape)
    expected_name hosted_dsl_name =
  match ctx.eval_expr env hosted_dsl_name with
  | Error diagnostics -> Error diagnostics
  | Ok hosted_dsl_name -> (
      match scalar_string hosted_dsl_name with
      | Some hosted_dsl_name when hosted_dsl_name = expected_name -> Ok ()
      | Some hosted_dsl_name ->
          Error
            [
              diagnostic "eval/protocol-hosted-dsl-name"
                (Printf.sprintf "%s expects hosted DSL %s, got %s."
                   shape.op_name expected_name hosted_dsl_name);
            ]
      | None ->
          Error
            [
              diagnostic "eval/protocol-hosted-dsl-name"
                (Printf.sprintf "%s expects hosted DSL name to be a string."
                   shape.op_name);
            ])

let execute_protocol_layout layout
    (context : Eval_meta_protocol_assembly.protocol_context) =
  let layout =
    Eval_meta_protocol_lowering.rewrite_layout_aliases_with_context
      context.layout_aliases layout
  in
  Option.value ~default:VNil
    (Eval_meta_protocol_component_tree.compile_layout_tree context.tree_context
       layout)

let assemble_protocol_execution_request env
    (runtime : protocol_runtime_contract) (request : protocol_request) =
  match
    Eval_meta_protocol_assembly.assemble_protocol_context_with_registry_env env
      runtime.registry_env request.component_extension
  with
  | Error diagnostics -> Error diagnostics
  | Ok context -> Ok { context; layout_expr = request.layout_expr }

let execute_protocol_request ctx env (request : protocol_execution_request) =
  match ctx.eval_expr env request.layout_expr with
  | Error diagnostics -> Error diagnostics
  | Ok layout -> Ok (Some (execute_protocol_layout layout request.context))

let resolve_component_extension ctx env (shape : protocol_runtime_shape)
    component_kind =
  match ctx.eval_expr env component_kind with
  | Error diagnostics -> Error diagnostics
  | Ok component_kind -> (
      match scalar_string component_kind |> Option.map normalize_name with
      | None ->
          Error
            [
              diagnostic "eval/protocol-component-kind"
                (Printf.sprintf
                   "%s expects component kind to be a symbol, keyword, or \
                    string."
                   shape.op_name);
            ]
      | Some component_extension -> Ok component_extension)

let resolve_protocol_request ctx env (shape : protocol_runtime_shape) args =
  match args with
  | [ layout_expr ] -> (
      match default_component_extension shape with
      | Some component_extension -> Ok { component_extension; layout_expr }
      | None ->
          Error
            [
              diagnostic "eval/arity"
                (Printf.sprintf "%s does not accept layout-only arguments."
                   shape.op_name);
            ])
  | [ component_kind; layout_expr ] -> (
      match resolve_component_extension ctx env shape component_kind with
      | Error diagnostics -> Error diagnostics
      | Ok component_extension -> Ok { component_extension; layout_expr })
  | [ hosted_dsl_name; component_kind; layout_expr ] -> (
      match expected_hosted_dsl_name shape with
      | Some expected_name -> (
          match
            resolve_hosted_dsl_name ctx env shape expected_name hosted_dsl_name
          with
          | Error diagnostics -> Error diagnostics
          | Ok () -> (
              match
                resolve_component_extension ctx env shape component_kind
              with
              | Error diagnostics -> Error diagnostics
              | Ok component_extension ->
                  Ok { component_extension; layout_expr }))
      | None ->
          Error
            [
              diagnostic "eval/arity"
                (Printf.sprintf "%s does not accept hosted DSL name arguments."
                   shape.op_name);
            ])
  | _ ->
      Error
        [
          diagnostic "eval/arity"
            (Printf.sprintf "%s expects %s." shape.op_name
               (String.concat ", " (expected_invocation_descriptions shape)));
        ]

let eval ctx env op args =
  match Eval_meta_protocol_assembly.assemble_runtime_contract_for_op env op with
  | None -> Ok None
  | Some runtime -> (
      let shape = runtime.shape in
      match resolve_protocol_request ctx env shape args with
      | Error diagnostics -> Error diagnostics
      | Ok request -> (
          match assemble_protocol_execution_request env runtime request with
          | Error diagnostics -> Error diagnostics
          | Ok execution_request ->
              execute_protocol_request ctx env execution_request))
