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
  | TERowOp of Ast.span * string * type_expr list * (Ast.span * string) list

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

val node : Ast.span -> node
val expr_node : expr -> node
val expr_span : expr -> Ast.span
val reset_node_ids : unit -> unit
val expr_to_json : expr -> string
val program_to_json : program -> string
val type_expr_to_json : type_expr -> string
