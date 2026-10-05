open Mechanics_artifact_payload

(* Shared context for projecting effect bodies; mirrors the TypeScript
   BodyContext in packages/ts/src/mechanics/artifact.ts. *)
type context = {
  source_id : string;
  service_effects : (string * Ir_json.t) list;
  operation_effects : (string * Ir_json.t) list;
  effect : Ir_json.t;
  diagnostics : Eval.diagnostic list ref;
}

let make_context ~source_id ~service_effects ~operation_effects effect =
  { source_id; service_effects; operation_effects; effect; diagnostics = ref [] }

let context_diagnostics context = !(context.diagnostics)

let add_diagnostics context diagnostics =
  context.diagnostics := !(context.diagnostics) @ diagnostics

let source_span_json source_id span =
  Ir_json.Object
    [
      ("sourceId", Ir_json.String source_id);
      ("startOffset", Ir_json.Int span.Ast.start_offset);
      ("endOffset", Ir_json.Int span.Ast.end_offset);
    ]

let source_json source_id expr = source_span_json source_id (Ast.expr_span expr)

let obj kind entries = Ir_json.Object (("kind", Ir_json.String kind) :: entries)

(* The TypeScript reader reads keywords and nil as symbols, so its symName
   sees them as symbol names. *)
let sym_name = function
  | Ast.Symbol (_, name) | Ast.Keyword (_, name) -> Some name
  | Ast.Nil _ -> Some "nil"
  | _ -> None

let is_keyword_name name = String.length name > 0 && Char.equal name.[0] ':'

let is_keyword_expr expr =
  match sym_name expr with Some name -> is_keyword_name name | None -> false

let strip_keyword name =
  if is_keyword_name name then String.sub name 1 (String.length name - 1)
  else name

let rec value_json source_id expr =
  let span = ("span", source_json source_id expr) in
  match expr with
  | Ast.Symbol (_, name) when not (is_keyword_name name) ->
      obj "Var" [ ("name", Ir_json.String name); span ]
  | Ast.Nil _ -> obj "Var" [ ("name", Ir_json.String "nil"); span ]
  | Ast.String (_, value) -> obj "Literal" [ ("value", Ir_json.String value); span ]
  | Ast.Int (_, value) -> obj "Literal" [ ("value", Ir_json.Int value); span ]
  | Ast.Float (_, value) -> obj "Literal" [ ("value", Ir_json.Float value); span ]
  | Ast.Bool (_, value) -> obj "Literal" [ ("value", Ir_json.Bool value); span ]
  | Ast.List (_, items) ->
      obj "List"
        [ ("items", Ir_json.Array (List.map (value_json source_id) items)); span ]
  | Ast.Vector (_, items) ->
      obj "Vector"
        [ ("items", Ir_json.Array (List.map (value_json source_id) items)); span ]
  | Ast.Map (_, entries) ->
      let entry (key, value) =
        Ir_json.Object
          [ ("key", value_json source_id key); ("value", value_json source_id value) ]
      in
      obj "Record" [ ("entries", Ir_json.Array (List.map entry entries)); span ]
  | Ast.Symbol _ | Ast.Keyword _ ->
      obj "Expr"
        [ ("source", Mechanics_signature_json.expr_to_payload_json expr); span ]

let error_value_json source_id expr =
  match expr with
  | Ast.List (_, [ error_type; payload ]) when Option.is_some (scalar_name error_type) ->
      obj "Error"
        [
          ("errorType", Ir_json.String (Option.get (scalar_name error_type)));
          ("payload", value_json source_id payload);
          ("span", source_json source_id expr);
        ]
  | expr -> value_json source_id expr

(* Records a projection diagnostic and returns the placeholder node the
   TypeScript projection emits in its place. *)
let report context expr message =
  add_diagnostics context
    [ diagnostic ~span:(Ast.expr_span expr) "artifact/effect-body" message ];
  obj "Pure"
    [
      ("value", obj "Literal" [ ("value", Ir_json.Null) ]);
      ("effect", context.effect);
      ("span", source_json context.source_id expr);
    ]
