open Mechanics_artifact_payload
open Mechanics_value_json

(* Mirrors effectCoreExprToJson and friends in
   packages/ts/src/mechanics/artifact.ts. *)

(* TypeScript: head.includes(".") && !head.startsWith("."), then
   head.split(".", 2). *)
let service_and_method head =
  match String.index_opt head '.' with
  | Some index when index > 0 ->
      let rest = String.sub head (index + 1) (String.length head - index - 1) in
      let method_name =
        match String.index_opt rest '.' with
        | Some next -> String.sub rest 0 next
        | None -> rest
      in
      if method_name = "" then None
      else Some (String.sub head 0 index, method_name)
  | _ -> None

let unwrap_arrow_bind = function
  | Ast.List (_, Ast.Symbol (_, "<-") :: inner :: _) -> inner
  | expr -> expr

let rec effect_json context expr =
  let source_id = context.source_id in
  let node kind entries =
    obj kind (entries @ [ ("effect", context.effect); ("span", source_json source_id expr) ])
  in
  let values args = Ir_json.Array (List.map (value_json source_id) args) in
  match expr with
  | Ast.Symbol (_,n) when Option.is_some (service_and_method n) && (match List.assoc_opt n context.service_effects with Some (Ir_json.Object fields) -> List.assoc_opt "value" fields = Some (Ir_json.Bool true) | _ -> false) ->
      let service,method_name = Option.get (service_and_method n) in
      let effect = List.assoc n context.service_effects in
      let effect = match effect with Ir_json.Object fields -> Ir_json.Object (List.remove_assoc "value" fields) | _ -> effect in
      obj "ServiceCall" ["service",Ir_json.String service;"method",Ir_json.String method_name;"args",Ir_json.Array [];"effect",effect;"value",Ir_json.Bool true;"span",source_json source_id expr]
  | Ast.List (_, (head_expr :: args as items)) -> (
      let head = sym_name head_expr in
      let count = List.length items in
      match (head, Option.bind head service_and_method) with
      | Some head, Some (service, method_name) ->
          obj "ServiceCall"
            [
              ("service", Ir_json.String service);
              ("method", Ir_json.String method_name);
              ("args", values args);
              ( "effect",
                Option.value (List.assoc_opt head context.service_effects)
                  ~default:context.effect );
              ("span", source_json source_id expr);
            ]
      | Some head, None when List.mem_assoc head context.operation_effects ->
          obj "OperationCall"
            [
              ("operation", Ir_json.String head);
              ("args", values args);
              ("effect", List.assoc head context.operation_effects);
              ("span", source_json source_id expr);
            ]
      | Some head, None when Option.is_some (Mechanics_effect_combinator_json.find head) ->
          Mechanics_effect_combinator_json.combinator_json ~core:effect_json
            ~body_forms:body_forms_json context expr head
            (Option.get (Mechanics_effect_combinator_json.find head))
            args
      | Some "succeed", None ->
          if count <> 2 then report context expr "succeed expects exactly one value."
          else node "Succeed" [ ("value", value_json source_id (List.hd args)) ]
      | Some "fail", None ->
          if count <> 2 then report context expr "fail expects exactly one error value."
          else node "Fail" [ ("error", error_value_json source_id (List.hd args)) ]
      | Some "catch", None ->
          Mechanics_effect_combinator_json.catch_json ~core:effect_json context expr args
      | Some "<-", None ->
          if count <> 2 then report context expr "<- expects exactly one effect."
          else node "Bind" [ ("value", effect_json context (List.hd args)) ]
      | Some "do", None ->
          node "Do" [ ("forms", Ir_json.Array (List.map (effect_json context) args)) ]
      | Some "if", None -> (
          match args with
          | [ condition; then_expr; else_expr ] ->
              node "If"
                [
                  ("condition", value_json source_id condition);
                  ("then", effect_json context then_expr);
                  ("else", effect_json context else_expr);
                ]
          | _ ->
              report context expr
                "if expects a condition, a then branch, and an else branch; use when or \
                 unless for one branch.")
      | Some (("when" | "unless") as head), None -> (
          match args with
          | condition :: (_ :: _ as body) ->
              node
                (if head = "when" then "When" else "Unless")
                [
                  ("condition", value_json source_id condition);
                  ("body", body_forms_json context body);
                ]
          | _ -> report context expr (head ^ " expects a condition and a body."))
      | Some "cond", None -> cond_json context expr args
      | Some (("do!" | "let") as head), None ->
          bindings_form_json context expr head args
      | Some "match", None -> match_json context expr args
      | _ -> pure_json context expr)
  | _ -> pure_json context expr

and pure_json context expr =
  obj "Pure"
    [
      ("value", value_json context.source_id expr);
      ("effect", context.effect);
      ("span", source_json context.source_id expr);
    ]

and cond_json context expr args =
  let rec clauses acc = function
    | condition :: body :: rest ->
        let clause =
          Ir_json.Object
            [
              ("condition", value_json context.source_id condition);
              ("body", effect_json context body);
              ("span", source_json context.source_id condition);
            ]
        in
        clauses (clause :: acc) rest
    | _ -> List.rev acc
  in
  if args = [] || List.length args mod 2 <> 0 then
    report context expr "cond expects condition/body pairs."
  else
    obj "Cond"
      [
        ("clauses", Ir_json.Array (clauses [] args));
        ("effect", context.effect);
        ("span", source_json context.source_id expr);
      ]

and bindings_form_json context expr head args =
  match args with
  | Ast.Vector (_, items) :: _ when List.length items mod 2 <> 0 ->
      report context expr (head ^ " expects a [name value ...] binding vector.")
  | (Ast.Vector _ as bindings) :: (_ :: _ as body) ->
      obj
        (if head = "do!" then "Do" else "Let")
        [
          ("bindings", Ir_json.Array (bindings_json context bindings));
          ("body", body_forms_json context body);
          ("effect", context.effect);
          ("span", source_json context.source_id expr);
        ]
  | [ Ast.Vector _ ] -> report context expr (head ^ " expects a body after its bindings.")
  | _ -> report context expr (head ^ " expects a [name value ...] binding vector.")

and bindings_json context = function
  | Ast.Vector (_, items) as bindings_expr ->
      if List.length items mod 2 <> 0 then (
        ignore (report context bindings_expr "bindings must be [name value ...] pairs.");
        [])
      else
        let rec loop acc = function
          | Ast.Keyword (_,":let") :: Ast.Vector (_,pure) :: rest ->
              let rec pure_bindings = function
                | n :: value :: tail ->
                    let entry = Ir_json.Object ["name",Ir_json.String (Option.value ~default:"_" (scalar_name n));"value",obj "Pure" ["value",value_json context.source_id value;"effect",context.effect;"span",source_json context.source_id value];"pure",Ir_json.Bool true;"span",source_json context.source_id value] in
                    entry :: pure_bindings tail
                | [] -> [] | _ -> ignore (report context bindings_expr ":let expects pattern/value pairs."); [] in
              loop (List.rev (pure_bindings pure) @ acc) rest
          | name :: value :: rest -> (
              let binding_name =
                match name with
                | Ast.Symbol _ | Ast.Keyword _ | Ast.Nil _ -> scalar_name name
                | _ -> None
              in
              match binding_name with
              | None ->
                  ignore (report context name "binding names must be symbols.");
                  loop acc rest
              | Some binding_name ->
                  let value = unwrap_arrow_bind value in
                  let binding =
                    Ir_json.Object
                      [
                        ("name", Ir_json.String binding_name);
                        ("value", effect_json context value);
                        ("span", source_json context.source_id value);
                      ]
                  in
                  loop (binding :: acc) rest)
          | _ -> List.rev acc
        in
        loop [] items
  | _ -> []

and match_json context expr args =
  match args with
  | value :: (_ :: _ :: _ as arms) when List.length arms mod 2 = 0 ->
      let rec loop acc = function
        | pattern :: body :: rest ->
            let arm =
              Ir_json.Object
                [
                  ("pattern", value_json context.source_id pattern);
                  ("body", effect_json context body);
                  ("span", source_json context.source_id pattern);
                ]
            in
            loop (arm :: acc) rest
        | _ -> List.rev acc
      in
      obj "Match"
        [
          ("value", value_json context.source_id value);
          ("arms", Ir_json.Array (loop [] arms));
          ("effect", context.effect);
          ("span", source_json context.source_id expr);
        ]
  | _ -> report context expr "match expects a value and pattern/body pairs."

and body_forms_json context = function
  | [ body ] -> effect_json context body
  | [] ->
      obj "Pure"
        [
          ("value", obj "Var" [ ("name", Ir_json.String "nil") ]);
          ("effect", context.effect);
        ]
  | first :: _ as bodies ->
      obj "Do"
        [
          ("forms", Ir_json.Array (List.map (effect_json context) bodies));
          ("effect", context.effect);
          ("span", source_json context.source_id first);
        ]
