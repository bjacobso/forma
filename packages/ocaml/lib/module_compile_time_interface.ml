open Module_contract
open Module_compile_time_syntax

let enrich (m : resolved_module) (state : compile_time) (b : binding) =
  let read = state.read and origins = state.origins and types = state.types in
  if b.identity.module_id <> m.id then b
  else
    let data =
      if b.kind = "declaration" || b.kind = "value" then
        try
          let value = data_json (read b.symbol) in
          let facets =
            match b.declaration with
            | None -> []
            | Some declaration ->
                let form =
                  List.assoc (symbol declaration.form) (state.forms ())
                in
                let _, _, options, _ = form_parts form.definition in
                let payload =
                  match List.assoc_opt ":ir" options with
                  | Some (Ast.Symbol (_, n) as t) ->
                      Option.value ~default:t
                        (List.assoc_opt n form.owner.types)
                  | Some t -> t
                  | None -> Ast.Symbol (declaration.span, "Any")
                in
                let contract = syntax_json payload in
                let fields pairs =
                  Ir_json.Object
                    [
                      ( "fields",
                        Ir_json.Array
                          (List.map
                             (fun (k, v) ->
                               Ir_json.Array [ Ir_json.String k; v ])
                             pairs) );
                    ]
                in
                [
                  ("contract", contract);
                  ( "scheme",
                    Ir_json.Object
                      [
                        ("parameters", Ir_json.Array []);
                        ( "type",
                          fields
                            [
                              ( ":identity",
                                fields
                                  [
                                    (":moduleId", Ir_json.String "String");
                                    (":declaration", Ir_json.String "String");
                                  ] );
                              (":classification", Ir_json.String "Symbol");
                              (":data", contract);
                            ] );
                      ] );
                ]
          in
          Some
            (Ir_json.Object
               ([
                  ("value", value);
                  ( "provenance",
                    Ir_json.Array
                      (Option.value ~default:[]
                         (Hashtbl.find_opt origins b.symbol)) );
                ]
               @ facets))
        with
        | Invalid_argument _ | Not_found -> None
        | Error _ as error ->
            if b.kind = "declaration" then raise error else None
      else None
    in
    let schema = Option.map syntax_json (List.assoc_opt b.symbol types) in
    let form =
      Option.map
        (fun form ->
          let patterns, holes, options, body = form_parts form.definition in
          Ir_json.Object
            ([
               ("pattern", Ir_json.Array (List.map syntax_json patterns));
               ( "holes",
                 Ir_json.Object
                   [
                     ( "fields",
                       Ir_json.Array
                         (List.map
                            (fun (n, t) ->
                              Ir_json.Array
                                [ Ir_json.String (":" ^ n); syntax_json t ])
                            holes) );
                   ] );
               ( "options",
                 Ir_json.Object
                   [
                     ( "fields",
                       Ir_json.Array
                         (List.map
                            (fun (n, t) ->
                              Ir_json.Array [ Ir_json.String n; syntax_json t ])
                            options) );
                   ] );
               ("projection", syntax_json body);
               ( "dependencies",
                 Ir_json.Array
                   (List.map (fun n -> Ir_json.String n) m.dependencies) );
               ( "completionShape",
                 Ir_json.String
                   ("(" ^ b.symbol ^ " "
                   ^ String.concat " "
                       (List.map
                          (fun p -> Option.value ~default:"options" (name p))
                          patterns)
                   ^ ")") );
             ]
            @
            match form.definition with
            | Ast.List (_, _ :: _ :: Ast.String (_, doc) :: _) ->
                [ ("doc", Ir_json.String doc) ]
            | _ -> []))
        (List.assoc_opt b.symbol (state.forms ()))
    in
    { b with data; schema; form }
