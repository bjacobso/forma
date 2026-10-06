type node = { id : int; span : Ast.span }

type literal =
  | LNil
  | LBool of bool
  | LInt of int
  | LFloat of float
  | LString of string
  | LKeyword of string
  | LSymbol of string
  | LQuoted of Ast.expr

type type_expr =
  | TESym of Ast.span * string
  | TEFun of Ast.span * type_expr list * type_expr
  | TEApp of Ast.span * type_expr * type_expr list
  | TERow of Ast.span * (string * type_expr) list * string option

type param = { node : node; name : string }
type pattern = PCon of string * string list | PWild | PData of Ast.expr

type binding = { node : node; name : string; expr : expr }
and field = { node : node; label : string; value : expr }
and match_arm = { pattern : pattern; body : expr }

and dsl_child = {
  slot_name : string;
  expr : expr;
  expected_type : type_expr option;
}

and dsl_form = { name : string; children : dsl_child list }

and expr =
  | Lit of node * literal
  | Var of node * string
  | Lam of node * param list * param option * expr
  | App of node * expr * expr list
  | Let of node * binding list * expr
  | EffectDo of node * binding list * expr
  | EffectFail of node * string * expr
  | EffectCatch of node * expr * string * param * expr
  | If of node * expr * expr * expr
  | Record of node * field list
  | Get of node * expr * string
  | Def of node * string * type_expr option * expr
  | Ascribe of node * expr * type_expr
  | Match of node * expr * match_arm list
  | TypeDef of node * string * type_expr option
  | DslForm of node * dsl_form

type program = expr list

let next_node_id = ref 0
let reset_node_ids () = next_node_id := 0

let node span =
  let id = !next_node_id in
  incr next_node_id;
  { id; span }

let expr_node = function
  | Lit (node, _)
  | Var (node, _)
  | Lam (node, _, _, _)
  | App (node, _, _)
  | Let (node, _, _)
  | EffectDo (node, _, _)
  | EffectFail (node, _, _)
  | EffectCatch (node, _, _, _, _)
  | If (node, _, _, _)
  | Record (node, _)
  | Get (node, _, _)
  | Def (node, _, _, _)
  | Ascribe (node, _, _)
  | Match (node, _, _)
  | TypeDef (node, _, _)
  | DslForm (node, _) ->
      node

let expr_span expr = (expr_node expr).span
let string_json = Value.string_json

let span_to_json span =
  Printf.sprintf "{\"sourceId\":%s,\"startOffset\":%d,\"endOffset\":%d}"
    (string_json span.Ast.source_id)
    span.start_offset span.end_offset

let node_to_json node =
  Printf.sprintf "\"id\":%d,\"span\":%s" node.id (span_to_json node.span)

let field_json name value = Printf.sprintf "\"%s\":%s" name value
let string_field_json name value = field_json name (string_json value)

let list_json encode values =
  Printf.sprintf "[%s]" (String.concat "," (List.map encode values))

let rec type_expr_to_json = function
  | TESym (span, name) ->
      Printf.sprintf "{\"kind\":\"type-symbol\",\"span\":%s,%s}"
        (span_to_json span)
        (string_field_json "name" name)
  | TEFun (span, params, ret) ->
      Printf.sprintf
        "{\"kind\":\"type-function\",\"span\":%s,\"params\":%s,\"return\":%s}"
        (span_to_json span)
        (list_json type_expr_to_json params)
        (type_expr_to_json ret)
  | TEApp (span, callee, args) ->
      Printf.sprintf
        "{\"kind\":\"type-application\",\"span\":%s,\"callee\":%s,\"args\":%s}"
        (span_to_json span) (type_expr_to_json callee)
        (list_json type_expr_to_json args)
  | TERow (span, fields, tail) ->
      let field_to_json (label, typ) =
        Printf.sprintf "{%s,\"type\":%s}"
          (string_field_json "label" label)
          (type_expr_to_json typ)
      in
      let tail_json =
        match tail with
        | None -> "\"tail\":null"
        | Some tail -> string_field_json "tail" tail
      in
      Printf.sprintf "{\"kind\":\"type-row\",\"span\":%s,\"fields\":%s,%s}"
        (span_to_json span)
        (list_json field_to_json fields)
        tail_json

let literal_to_json = function
  | LNil -> "{\"kind\":\"nil\"}"
  | LBool value ->
      Printf.sprintf "{\"kind\":\"bool\",\"value\":%s}" (string_of_bool value)
  | LInt value -> Printf.sprintf "{\"kind\":\"int\",\"value\":%d}" value
  | LFloat value ->
      Printf.sprintf "{\"kind\":\"float\",\"value\":%s}" (string_of_float value)
  | LString value ->
      Printf.sprintf "{\"kind\":\"string\",\"value\":%s}" (string_json value)
  | LQuoted value -> Printf.sprintf "{\"kind\":\"quoted\",\"value\":%s}" (Value.to_json (Quote.value_of_syntax value))
  | LSymbol value ->
      Printf.sprintf "{\"kind\":\"symbol\",\"value\":%s}" (string_json value)
  | LKeyword value ->
      Printf.sprintf "{\"kind\":\"keyword\",\"value\":%s}" (string_json value)

let param_to_json (param : param) =
  Printf.sprintf "{%s,%s}" (node_to_json param.node)
    (string_field_json "name" param.name)

let pattern_to_json = function
  | PWild -> "{\"kind\":\"wildcard\"}"
  | PData syntax -> Printf.sprintf "{\"kind\":\"data\",\"syntax\":%s}" (Ast.expr_to_json syntax)
  | PCon (name, vars) ->
      Printf.sprintf "{\"kind\":\"constructor\",%s,\"vars\":%s}"
        (string_field_json "name" name)
        (list_json string_json vars)

let rec expr_to_json expr =
  let node = expr_node expr in
  let base kind fields =
    Printf.sprintf "{%s,%s%s}" (node_to_json node)
      (string_field_json "kind" kind)
      (match fields with [] -> "" | _ -> "," ^ String.concat "," fields)
  in
  match expr with
  | Lit (_, literal) ->
      base "literal" [ field_json "literal" (literal_to_json literal) ]
  | Var (_, name) -> base "variable" [ string_field_json "name" name ]
  | Lam (_, params, rest_param, body) ->
      let rest_json =
        match rest_param with
        | None -> "\"restParam\":null"
        | Some param -> field_json "restParam" (param_to_json param)
      in
      base "lambda"
        [
          field_json "params" (list_json param_to_json params);
          rest_json;
          field_json "body" (expr_to_json body);
        ]
  | App (_, callee, args) ->
      base "application"
        [
          field_json "callee" (expr_to_json callee);
          field_json "args" (list_json expr_to_json args);
        ]
  | Let (_, bindings, body) ->
      let binding_to_json (binding : binding) =
        Printf.sprintf "{%s,%s,\"expr\":%s}"
          (node_to_json binding.node)
          (string_field_json "name" binding.name)
          (expr_to_json binding.expr)
      in
      base "let"
        [
          field_json "bindings" (list_json binding_to_json bindings);
          field_json "body" (expr_to_json body);
        ]
  | EffectDo (_, bindings, body) ->
      let binding_to_json (binding : binding) =
        Printf.sprintf "{%s,%s,\"expr\":%s}"
          (node_to_json binding.node)
          (string_field_json "name" binding.name)
          (expr_to_json binding.expr)
      in
      base "effect-do"
        [
          field_json "bindings" (list_json binding_to_json bindings);
          field_json "body" (expr_to_json body);
        ]
  | EffectFail (_, error_name, payload) ->
      base "effect-fail"
        [
          string_field_json "errorName" error_name;
          field_json "payload" (expr_to_json payload);
        ]
  | EffectCatch (_, body, error_name, binding, handler) ->
      base "effect-catch"
        [
          field_json "body" (expr_to_json body);
          string_field_json "errorName" error_name;
          field_json "binding" (param_to_json binding);
          field_json "handler" (expr_to_json handler);
        ]
  | If (_, condition, consequent, alternate) ->
      base "if"
        [
          field_json "condition" (expr_to_json condition);
          field_json "then" (expr_to_json consequent);
          field_json "else" (expr_to_json alternate);
        ]
  | Record (_, fields) ->
      let field_to_json (field : field) =
        Printf.sprintf "{%s,%s,\"value\":%s}" (node_to_json field.node)
          (string_field_json "label" field.label)
          (expr_to_json field.value)
      in
      base "record" [ field_json "fields" (list_json field_to_json fields) ]
  | Get (_, record, label) ->
      base "get"
        [
          field_json "record" (expr_to_json record);
          string_field_json "label" label;
        ]
  | Def (_, name, signature, value) ->
      let signature_json =
        match signature with
        | None -> "\"signature\":null"
        | Some signature -> field_json "signature" (type_expr_to_json signature)
      in
      base "definition"
        [
          string_field_json "name" name;
          signature_json;
          field_json "value" (expr_to_json value);
        ]
  | Ascribe (_, value, typ) ->
      base "ascription"
        [
          field_json "expr" (expr_to_json value);
          field_json "type" (type_expr_to_json typ);
        ]
  | Match (_, scrutinee, arms) ->
      let arm_to_json arm =
        Printf.sprintf "{\"pattern\":%s,\"body\":%s}"
          (pattern_to_json arm.pattern)
          (expr_to_json arm.body)
      in
      base "match"
        [
          field_json "scrutinee" (expr_to_json scrutinee);
          field_json "arms" (list_json arm_to_json arms);
        ]
  | TypeDef (_, name, typ) ->
      let typ_json =
        match typ with
        | None -> "\"type\":null"
        | Some typ -> field_json "type" (type_expr_to_json typ)
      in
      base "type-definition" [ string_field_json "name" name; typ_json ]
  | DslForm (_, form) ->
      let child_to_json child =
        let expected_json =
          match child.expected_type with
          | None -> "\"expectedType\":null"
          | Some typ -> field_json "expectedType" (type_expr_to_json typ)
        in
        Printf.sprintf "{%s,\"expr\":%s,%s}"
          (string_field_json "slotName" child.slot_name)
          (expr_to_json child.expr) expected_json
      in
      base "dsl-form"
        [
          string_field_json "name" form.name;
          field_json "children" (list_json child_to_json form.children);
        ]

let program_to_json program = list_json expr_to_json program
