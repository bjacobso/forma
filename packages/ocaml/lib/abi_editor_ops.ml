type request = Abi_request.t

module Response = Abi_response

let string_json = Value.string_json

let list_json encode values =
  Printf.sprintf "[%s]" (String.concat "," (List.map encode values))

let source_id (request : request) =
  match request.source_id with Some id -> id | None -> "request"

let missing_source operation =
  Response.error_json
    [
      Response.diagnostic_json ~code:"abi/missing-source"
        ~message:
          (Printf.sprintf
             "%s requires either source, or sessionId plus sourceId." operation);
    ]

let with_exprs ~with_session operation (request : request) k =
  match (request.source, request.session_id, request.source_id) with
  | Some source, Some session_id, _ -> (
      match Reader.parse_ast ~source_id:(source_id request) source with
      | Error diagnostics ->
          k None [] (List.map Reader.diagnostic_to_json diagnostics)
      | Ok exprs ->
          with_session (Some session_id) (fun session ->
              k (Some session) exprs []))
  | Some source, None, _ -> (
      match Reader.parse_ast ~source_id:(source_id request) source with
      | Error diagnostics ->
          k None [] (List.map Reader.diagnostic_to_json diagnostics)
      | Ok exprs -> k None exprs [])
  | None, Some session_id, Some source_id ->
      with_session (Some session_id) (fun session ->
          match Hashtbl.find_opt session.Session.parsed_sources source_id with
          | Some exprs -> k (Some session) exprs []
          | None ->
              Response.error_json
                [
                  Response.diagnostic_json ~code:"abi/unknown-source"
                    ~message:
                      (Printf.sprintf "Unknown loaded source %S." source_id);
                ])
  | None, _, _ -> missing_source operation

let diagnostics_value diagnostics =
  Printf.sprintf "[%s]" (String.concat "," diagnostics)

let editor_response fields diagnostics =
  Printf.sprintf "{\"ok\":true,\"value\":{%s,\"diagnostics\":%s}}"
    (String.concat "," fields)
    (diagnostics_value diagnostics)

let span_json = Cst.span_to_json
let expr_span = Ast.expr_span

let symbol_name = function
  | Ast.Symbol (_, name) | Ast.Keyword (_, name) -> Some name
  | _ -> None

let binding_name_and_span = function
  | Ast.Symbol (span, name) | Ast.Keyword (span, name) -> Some (name, span)
  | Ast.List (_, (Ast.Symbol (span, name) | Ast.Keyword (span, name)) :: _)
  | Ast.Vector (_, (Ast.Symbol (span, name) | Ast.Keyword (span, name)) :: _) ->
      Some (name, span)
  | _ -> None

type definition = {
  name : string;
  uri : string;
  span : Ast.span;
  detail : string;
}

let definition_to_json definition =
  Printf.sprintf "{\"name\":%s,\"uri\":%s,\"span\":%s,\"detail\":%s}"
    (string_json definition.name)
    (string_json definition.uri)
    (span_json definition.span)
    (string_json definition.detail)

let definition_of_expr env uri = function
  | Ast.List
      ( _,
        Ast.Symbol
          ( _,
            (( "define" | "macro" | "form" | "type" | "error" | "class"
             | "service" | "layer" | "typeclass" ) as
             detail) )
        :: binding :: _ ) -> (
      match binding_name_and_span binding with
      | Some (name, span) -> Some { name; uri; span; detail }
      | None -> None)
  | (Ast.List (span, Ast.Symbol (_, op) :: args) as expression)
    when Option.fold ~none:false ~some:(fun env -> Descriptor.is_form_descriptor env op) env ->
      Option.bind env (fun env ->
        Option.map (fun name ->
          let binding_span =
            if Env.lookup ("__form/" ^ op) env=None then span else
            match Descriptor.form env op with
            | None -> span
            | Some descriptor ->
                let normalized=Surface_form.normalize_application env op args in
                let identifiers=List.filter (function Ast.Symbol _ -> true | _ -> false) normalized in
                let declared = match Env.lookup ("__form.types/" ^ op) env with
                  | Some (Value.VMap fields) -> List.find_opt (fun (id:Descriptor.identifier_spec) ->
                      match List.assoc_opt (Value.VKeyword (":" ^ id.name)) fields with
                      | Some (Value.VList (Value.VSymbol "Declares" :: _)) -> true | _ -> false) descriptor.identifiers
                  | _ -> None in
                (match declared with Some id -> Option.fold ~none:span ~some:Ast.expr_span (List.nth_opt identifiers id.positional_index) | None -> span) in
          {name;uri;span=binding_span;detail=op}) (Source_bindings.binding_name env expression))
  | _ -> None

let definitions session uri exprs =
  let env = Option.map (fun session -> session.Session.env) session in
  exprs |> List.filter_map (definition_of_expr env uri)

let definitions_json definitions = list_json definition_to_json definitions

let builtin_completion_labels =
  ["define";"fn";"let";"if";"do";"do!";"match";"quote";"quasiquote";"unquote";
   "type";"error";"class";"service";"layer";"form";"macro";"typeclass";":";
   "list";"vector";"map";"get";"+";"-";"*";"/";"=";"<";"<=";">";">=";
   "and";"or";"not";"concat";"count";"first";"rest";"reduce"]

let completion_item ?(kind = "value") ?detail label =
  Printf.sprintf "{\"label\":%s,\"kind\":%s,%s}" (string_json label)
    (string_json kind)
    (match detail with
    | None -> "\"detail\":null"
    | Some detail -> Printf.sprintf "\"detail\":%s" (string_json detail))

let completions_json session definitions =
  let add_unique seen name =
    if List.mem name seen then seen else name :: seen
  in
  let names =
    builtin_completion_labels |> List.fold_left add_unique [] |> fun names ->
    List.fold_left
      (fun acc definition -> add_unique acc definition.name)
      names definitions
  in
  let names =
    match session with
    | None -> names
    | Some session ->
        List.fold_left
          (fun acc (name, _) -> if String.starts_with ~prefix:"__" name then acc else add_unique acc name)
          names session.Session.type_env
  in
  names |> List.sort String.compare
  |> list_json (fun name -> completion_item name)

let analyze_typed session exprs =
  let env =
    Option.fold ~none:Env.empty ~some:(fun s -> s.Session.env) session
  in
  match Eval.expand_program_with_env env exprs with
  | Error diagnostics -> Error (List.map Eval.diagnostic_to_json diagnostics)
  | Ok (expanded, _) -> (
      match Lower.program expanded with
      | Error diagnostics ->
          Error (List.map Lower.diagnostic_to_json diagnostics)
      | Ok program -> (
          let hooks =
            match session with
            | None -> Descriptor_protocol.empty_hooks
            | Some session ->
                Descriptor_contract.descriptor_hooks ~syntax:expanded session.Session.env
          in
          let type_env =
            match session with
            | None -> []
            | Some session -> session.Session.type_env
          in
          match
            Typecheck.typecheck_core_program_typed_with_descriptor_infer hooks
              type_env program
          with
          | Error diagnostics ->
              Error (List.map Type_diagnostic.to_json diagnostics)
          | Ok (typed, _) -> Ok typed))

let analyze ~with_session (request : request) =
  with_exprs ~with_session "editorAnalyze" request
    (fun session exprs parse_diagnostics ->
      let definitions = definitions session (source_id request) exprs in
      let fields =
        [
          Printf.sprintf "\"definitions\":%s" (definitions_json definitions);
          Printf.sprintf "\"completionItems\":%s"
            (completions_json session definitions);
        ]
      in
      if parse_diagnostics <> [] then
        editor_response ("\"typedCore\":null" :: fields) parse_diagnostics
      else
        match analyze_typed session exprs with
        | Error diagnostics ->
            editor_response ("\"typedCore\":null" :: fields) diagnostics
        | Ok typed ->
            editor_response
              (Printf.sprintf "\"typedCore\":%s" (Typed_core.to_json typed)
              :: fields)
              [])

let span_contains offset span =
  span.Ast.start_offset <= offset && offset < span.end_offset

let smallest_annotation_at offset annotations =
  annotations
  |> List.filter (fun annotation ->
      span_contains offset annotation.Typed_core.span)
  |> List.sort (fun left right ->
      compare
        (left.Typed_core.span.end_offset - left.span.start_offset)
        (right.span.end_offset - right.span.start_offset))
  |> List.find_opt (fun _ -> true)

let hover ~with_session (request : request) =
  let offset = Option.value request.offset ~default:0 in
  with_exprs ~with_session "editorHover" request
    (fun session exprs parse_diagnostics ->
      if parse_diagnostics <> [] then
        editor_response [ "\"hover\":null" ] parse_diagnostics
      else
        match analyze_typed session exprs with
        | Error diagnostics -> editor_response [ "\"hover\":null" ] diagnostics
        | Ok typed -> (
            match
              smallest_annotation_at offset typed.Typed_core.annotations
            with
            | None -> editor_response [ "\"hover\":null" ] []
            | Some annotation ->
                let typ = Type_expr.ty_to_string annotation.typ in
                editor_response
                  [
                    Printf.sprintf
                      "\"hover\":{\"range\":%s,\"contents\":%s,\"type\":%s}"
                      (span_json annotation.span)
                      (string_json (Printf.sprintf "**type:** `%s`" typ))
                      (string_json typ);
                  ]
                  []))

let completion ~with_session (request : request) =
  with_exprs ~with_session "editorCompletion" request
    (fun session exprs diagnostics ->
      let definitions = definitions session (source_id request) exprs in
      editor_response
        [ Printf.sprintf "\"items\":%s" (completions_json session definitions) ]
        diagnostics)

let rec symbol_at offset expr =
  let span = expr_span expr in
  if not (span_contains offset span) then None
  else
    let child =
      match expr with
      | Ast.List (_, items) | Ast.Vector (_, items) ->
          List.find_map (symbol_at offset) items
      | Ast.Map (_, entries) ->
          entries
          |> List.find_map (fun (key, value) ->
              match symbol_at offset key with
              | Some _ as found -> found
              | None -> symbol_at offset value)
      | _ -> None
    in
    match child with
    | Some _ as found -> found
    | None -> Option.map (fun name -> (name, span)) (symbol_name expr)

let definition ~with_session (request : request) =
  let offset = Option.value request.offset ~default:0 in
  with_exprs ~with_session "editorDefinition" request
    (fun session exprs diagnostics ->
      let symbol = List.find_map (symbol_at offset) exprs in
      let definitions = definitions session (source_id request) exprs in
      let target =
        match symbol with
        | None -> "null"
        | Some (name, _) ->
            definitions
            |> List.find_opt (fun definition -> definition.name = name)
            |> Option.map definition_to_json
            |> Option.value ~default:"null"
      in
      editor_response [ Printf.sprintf "\"definition\":%s" target ] diagnostics)

let format ~with_session (request : request) =
  with_exprs ~with_session "editorFormat" request
    (fun session exprs diagnostics ->
      editor_response
        [
          Printf.sprintf "\"text\":%s"
            (let source = match request.source,session,request.source_id with
              | Some source,_,_ -> source
              | None,Some session,Some id -> Option.fold ~none:"" ~some:Source.text (Hashtbl.find_opt session.Session.sources id)
              | _ -> "" in
            string_json (Editor_format.format_source ~env:(Option.fold ~none:Env.empty ~some:(fun s->s.Session.env) session) source exprs));
        ]
        diagnostics)
