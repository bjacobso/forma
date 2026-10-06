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
}

type check_expr_handler =
  value -> value -> value -> (value, diagnostic list) result

type infer_expr_handler = value -> value -> (value, diagnostic list) result
type lookup_declaration_handler = string -> value option

let active_check_expr : check_expr_handler option ref = ref None
let active_infer_expr : infer_expr_handler option ref = ref None
let active_lookup_declaration : lookup_declaration_handler option ref = ref None

let with_check_expr handler thunk =
  let previous = !active_check_expr in
  active_check_expr := Some handler;
  Fun.protect ~finally:(fun () -> active_check_expr := previous) thunk

let with_infer_expr handler thunk =
  let previous = !active_infer_expr in
  active_infer_expr := Some handler;
  Fun.protect ~finally:(fun () -> active_infer_expr := previous) thunk

let with_lookup_declaration handler thunk =
  let previous = !active_lookup_declaration in
  active_lookup_declaration := Some handler;
  Fun.protect ~finally:(fun () -> active_lookup_declaration := previous) thunk

let current_lookup_declaration () = !active_lookup_declaration

let active_environment : Env.t option ref = ref None
let current_environment () = !active_environment
let with_environment env thunk =
  match !active_environment with
  | Some _ -> thunk ()
  | None ->
      active_environment := Some env;
      Fun.protect ~finally:(fun () -> active_environment := None) thunk

module Util = Eval_meta_util

let eval ctx env op args =
  let eval_expr = ctx.eval_expr in
  let eval_all = ctx.eval_all in
  let eval_required_builtin = ctx.eval_required_builtin in
  match
    Eval_meta_reflection.eval
      Eval_meta_reflection.{ eval_expr; eval_all }
      {
        current_check_expr = (fun () -> !active_check_expr);
        current_infer_expr = (fun () -> !active_infer_expr);
        current_lookup_declaration = (fun () -> !active_lookup_declaration);
      }
      env op args
  with
  | Ok (Some _ as value) -> Ok value
  | Ok None ->
      let builders_ctx : Eval_meta_builders.context =
        {
          eval_expr;
          eval_all;
          eval_required_builtin;
          current_lookup_declaration = (fun () -> !active_lookup_declaration);
          current_environment;
        }
      in
      Eval_meta_builders.eval builders_ctx env op args
  | Error _ as error -> error
