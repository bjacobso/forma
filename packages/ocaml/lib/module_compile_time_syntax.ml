open Module_contract

let rec syntax_json = function
  | Ast.Nil _ -> Ir_json.Null
  | Ast.Symbol (_, n) | Ast.Keyword (_, n) | Ast.String (_, n) ->
      Ir_json.String n
  | Ast.Int (_, n) -> Ir_json.Int n
  | Ast.Float (_, n) -> Ir_json.Float n
  | Ast.Bool (_, b) -> Ir_json.Bool b
  | Ast.List (_, xs) | Ast.Vector (_, xs) ->
      Ir_json.Array (List.map syntax_json xs)
  | Ast.Map (_, pairs) ->
      Ir_json.Object
        [
          ( "fields",
            Ir_json.Array
              (List.map
                 (fun (k, v) -> Ir_json.Array [ syntax_json k; syntax_json v ])
                 pairs) );
        ]

let rec data_json = function
  | Value.VNil -> Ir_json.Null
  | Value.VString n -> Ir_json.String n
  | Value.VInt n -> Ir_json.Int n
  | Value.VFloat n -> Ir_json.Float n
  | Value.VBool b -> Ir_json.Bool b
  | Value.VSymbol n -> Ir_json.Object [ ("symbol", Ir_json.String n) ]
  | Value.VKeyword n -> Ir_json.Object [ ("keyword", Ir_json.String n) ]
  | Value.VList xs | Value.VVector xs -> Ir_json.Array (List.map data_json xs)
  | Value.VMap pairs | Value.VDictionary pairs ->
      Ir_json.Object
        [
          ( "record",
            Ir_json.Array
              (List.map
                 (fun (k, v) -> Ir_json.Array [ data_json k; data_json v ])
                 pairs) );
        ]
  | _ -> invalid_arg "Value is not inspectable pure data."

let span_json (span : Ast.span) =
  Ir_json.Object
    [
      ("sourceId", Ir_json.String span.source_id);
      ("startOffset", Ir_json.Int span.start_offset);
      ("endOffset", Ir_json.Int span.end_offset);
    ]

let identity_json (identity : identity) =
  Ir_json.Object
    [
      ("moduleId", Ir_json.String identity.module_id);
      ("declaration", Ir_json.String identity.declaration);
    ]

let origin identity expr =
  Ir_json.Object
    [
      ("path", Ir_json.String "");
      ("identity", identity_json identity);
      ("span", span_json (Ast.expr_span expr));
    ]

(* Paths address the result; arbitrary pure helpers conservatively retain all
   contributing declaration origins on each member. *)
let member_origins value sources =
  let roots =
    List.filter
      (function
        | Ir_json.Object fields ->
            List.assoc_opt "path" fields = Some (Ir_json.String "")
        | _ -> false)
      sources
    |> List.sort_uniq Stdlib.compare
  in
  (* Keep declaration order identical to the source reference walk. *)
  let roots =
    List.filter (fun source -> List.mem source roots) sources
    |> List.fold_left
         (fun acc source ->
           if List.mem source acc then acc else acc @ [ source ])
         []
  in
  let escape key =
    String.split_on_char '/' key
    |> List.map (fun s -> String.split_on_char '~' s |> String.concat "~0")
    |> String.concat "~1"
  in
  let rec walk path value =
    let own =
      List.map
        (function
          | Ir_json.Object fields ->
              Ir_json.Object
                (List.map
                   (fun (k, v) ->
                     (k, if k = "path" then Ir_json.String path else v))
                   fields)
          | v -> v)
        roots
    in
    own
    @
    match value with
    | Value.VList xs | Value.VVector xs ->
        List.concat
          (List.mapi
             (fun i value -> walk (path ^ "/" ^ string_of_int i) value)
             xs)
    | Value.VMap fields | Value.VDictionary fields ->
        List.concat_map
          (fun (key, value) ->
            let key =
              match key with
              | Value.VKeyword n -> String.sub n 1 (String.length n - 1)
              | Value.VString n | Value.VSymbol n -> n
              | _ -> "key"
            in
            walk (path ^ "/" ^ escape key) value)
          fields
    | _ -> []
  in
  walk "" value

let unwrap = function
  | Ast.List (_, [ Ast.Symbol (_, "Option"); t ]) -> t
  | t -> t

let form_parts = function
  | Ast.List
      (_, Ast.Symbol (_, "form") :: Ast.List (_, _ :: patterns) :: options) ->
      let options = match options with Ast.String _ :: xs -> xs | xs -> xs in
      let rec pairs acc = function
        | [ body ] -> (List.rev acc, body)
        | Ast.Keyword (_, key) :: value :: rest ->
            pairs ((key, value) :: acc) rest
        | _ -> invalid_arg "Invalid form options"
      in
      let options, body = pairs [] options in
      let holes =
        match List.assoc_opt ":types" options with
        | Some (Ast.Map (_, holes)) ->
            List.map
              (fun (key, t) ->
                let key = Option.value ~default:"" (Surface.name key) in
                (String.sub key 1 (String.length key - 1), t))
              holes
        | _ -> []
      in
      (patterns, holes, options, body)
  | _ -> invalid_arg "Expected form definition"

let match_holes definition application =
  let patterns, _, _, _ = form_parts definition in
  let args =
    match application with Ast.List (_, _ :: args) -> args | _ -> []
  in
  let rec loop acc patterns args =
    match (patterns, args) with
    | [], [] -> List.rev acc
    | [ Ast.Symbol (_, n); Ast.Symbol (_, "...") ], args ->
        List.rev ((n, Ast.Vector (Ast.expr_span application, args)) :: acc)
    | Ast.Symbol (_, n) :: patterns, arg :: args ->
        loop ((n, arg) :: acc) patterns args
    | ( Ast.Map (_, [ (Ast.Keyword (_, ":keys"), Ast.Vector (_, keys)) ])
        :: patterns,
        args ) ->
        let allowed = List.filter_map name keys in
        let rec options acc = function
          | Ast.Keyword (_, key) :: value :: args ->
              let key = String.sub key 1 (String.length key - 1) in
              if not (List.mem key allowed) then
                fail value "elaborate/form-check" ("Unknown option :" ^ key);
              options ((key, value) :: acc) args
          | args -> loop acc patterns args
        in
        options acc args
    | _ ->
        fail application "elaborate/form-check"
          "Form arguments do not match their pattern."
  in
  loop [] patterns args

let rec is_syntax t =
  match unwrap t with
  | Ast.Symbol (_, n) ->
      List.mem n [ "Symbol"; "Type"; "Syntax"; "RuntimeExpr" ]
  | Ast.List (_, Ast.Symbol (_, n) :: _)
    when List.mem n [ "Declares"; "Refers"; "Expr" ] ->
      true
  | Ast.List (_, [ Ast.Symbol (_, "List"); t ]) -> is_syntax t
  | _ -> false

let discover expressions (bindings : (string * binding) list) imports namespaces
    owner_of =
  let forms =
    List.filter_map
      (fun e ->
        match e with
        | Ast.List
            ( _,
              Ast.Symbol (_, "form")
              :: Ast.List (_, Ast.Symbol (_, n) :: _)
              :: _ ) ->
            Some (n, (e, (List.assoc n bindings).identity))
        | _ -> None)
      expressions
  in
  let forms =
    forms
    @ List.filter_map
        (fun (n, (b : binding)) ->
          Option.bind (owner_of b.identity) (fun m ->
              Option.bind m.compile_time (fun state ->
                  Option.map
                    (fun form -> (n, (form.definition, form.form_identity)))
                    (List.assoc_opt b.symbol (state.forms ())))))
        imports
  in
  let forms =
    forms
    @ List.concat_map
        (fun (_, (b : binding)) ->
          if b.kind <> "macro" then []
          else
            match owner_of b.identity with
            | Some { compile_time = Some state; _ } ->
                List.map
                  (fun (n, form) -> (n, (form.definition, form.form_identity)))
                  (state.forms ())
            | _ -> [])
        imports
  in
  let forms =
    forms
    @ List.concat_map
        (fun (alias, m) ->
          match m.compile_time with
          | None -> []
          | Some state ->
              List.filter_map
                (fun (b : binding) ->
                  Option.map
                    (fun form ->
                      ( alias ^ "/" ^ b.name,
                        (form.definition, form.form_identity) ))
                    (List.assoc_opt b.symbol (state.forms ())))
                m.interface.exports)
        namespaces
  in
  List.concat_map
    (fun expression ->
      match Option.bind (head expression) (fun h -> List.assoc_opt h forms) with
      | None -> []
      | Some (definition, identity) ->
          let _, holes, _, _ = form_parts definition in
          let values = match_holes definition expression in
          List.filter_map
            (fun (hole, t) ->
              match (unwrap t, List.assoc_opt hole values) with
              | ( Ast.List
                    ( _,
                      Ast.Symbol (_, "Declares")
                      :: Ast.Symbol (_, classification)
                      :: _ ),
                  Some (Ast.Symbol (_, n) as node) ) ->
                  Some (n, node, classification, identity)
              | _ -> None)
            holes)
    expressions
