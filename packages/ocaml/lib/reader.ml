type span = Cst.span = {
  source_id : string;
  start_offset : int;
  end_offset : int;
}

type expr = Cst.expr =
  | Nil of span
  | Bool of span * bool
  | Int of span * int
  | Float of span * float
  | String of span * string
  | Symbol of span * string
  | Keyword of span * string
  | List of span * expr list
  | Vector of span * expr list
  | Map of span * (expr * expr) list

type diagnostic = Cst.diagnostic = {
  span : span option;
  code : string;
  message : string;
}

let span = Cst.span
let expr_span = Cst.expr_span
let expr_to_json = Cst.expr_to_json
let diagnostic_to_json = Cst.diagnostic_to_json

let is_delimiter = function
  | ' ' | '\n' | '\r' | '\t' | '(' | ')' | '[' | ']' | '{' | '}' | '"' | ';'
  | '\'' | '`' | '~' ->
      true
  | _ -> false

let is_symbol_start = function
  | 'a' .. 'z'
  | 'A' .. 'Z'
  | '.' | '-' | '_' | ':' | '?' | '!' | '*' | '+' | '/' | '<' | '>' | '=' | '$'
  | '&' ->
      true
  | _ -> false

let is_symbol_char = function
  | 'a' .. 'z'
  | 'A' .. 'Z'
  | '0' .. '9'
  | '-' | '_' | ':' | '?' | '!' | '*' | '+' | '/' | '<' | '>' | '=' | '$' | '.'
  | '&' ->
      true
  | _ -> false

let looks_like_float token =
  let has_digit = ref false in
  let has_float_marker = ref false in
  let valid = ref true in
  String.iter
    (function
      | '0' .. '9' -> has_digit := true
      | '.' | 'e' | 'E' -> has_float_marker := true
      | '+' | '-' -> ()
      | _ -> valid := false)
    token;
  !valid && !has_digit && !has_float_marker

let parse_cst ~source_id source =
  let len = String.length source in
  let error ?span code message = Error [ { span; code; message } ] in
  let rec skip_ws i =
    if i >= len then i
    else
      match source.[i] with
      | ' ' | '\n' | '\r' | '\t' -> skip_ws (i + 1)
      | ';' ->
          let rec skip_comment j =
            if j >= len then j
            else if source.[j] = '\n' then j + 1
            else skip_comment (j + 1)
          in
          skip_ws (skip_comment (i + 1))
      | _ -> i
  in
  let parse_string start =
    let buffer = Buffer.create 16 in
    let multiline =
      start + 2 < len && source.[start + 1] = '"' && source.[start + 2] = '"'
    in
    let unterminated_error =
      error ~span:(span source_id start len) "reader/unterminated-string"
        "Unterminated string literal."
    in
    if multiline then
      let rec loop i =
        if i >= len then unterminated_error
        else if
          i + 2 < len
          && source.[i] = '"'
          && source.[i + 1] = '"'
          && source.[i + 2] = '"'
        then
          Ok
            ( String (span source_id start (i + 3), Buffer.contents buffer),
              i + 3 )
        else (
          Buffer.add_char buffer source.[i];
          loop (i + 1))
      in
      loop (start + 3)
    else
      let rec loop i =
        if i >= len then unterminated_error
        else
          match source.[i] with
          | '"' ->
              Ok
                ( String (span source_id start (i + 1), Buffer.contents buffer),
                  i + 1 )
          | '\\' when i + 1 < len ->
              let escaped =
                match source.[i + 1] with
                | '"' -> '"'
                | '\\' -> '\\'
                | 'n' -> '\n'
                | 'r' -> '\r'
                | 't' -> '\t'
                | other -> other
              in
              Buffer.add_char buffer escaped;
              loop (i + 2)
          | '\\' ->
              error ~span:(span source_id start len)
                "reader/unterminated-string-escape"
                "Unterminated string escape."
          | c ->
              Buffer.add_char buffer c;
              loop (i + 1)
      in
      loop (start + 1)
  in
  let parse_atom start =
    let first = source.[start] in
    if not (('0' <= first && first <= '9') || is_symbol_start first) then
      error
        ~span:(span source_id start (start + 1))
        "reader/unexpected-character"
        (Printf.sprintf "Unexpected character: '%c'" first)
    else
      let rec token_end i =
        if
          i >= len || is_delimiter source.[i] || not (is_symbol_char source.[i])
        then i
        else token_end (i + 1)
      in
      let finish = token_end start in
      let token = String.sub source start (finish - start) in
      let span = span source_id start finish in
      match token with
      | "nil" -> Ok (Nil span, finish)
      | "true" -> Ok (Bool (span, true), finish)
      | "false" -> Ok (Bool (span, false), finish)
      | _ when String.length token > 0 && token.[0] = ':' ->
          Ok (Keyword (span, token), finish)
      | _ -> (
          match int_of_string_opt token with
          | Some value -> Ok (Int (span, value), finish)
          | None when looks_like_float token -> (
              match float_of_string_opt token with
              | Some value -> Ok (Float (span, value), finish)
              | None ->
                  error ~span "reader/invalid-number"
                    (Printf.sprintf "Invalid number literal: %s" token))
          | None -> Ok (Symbol (span, token), finish))
  in
  let rec parse_expr i =
    let i = skip_ws i in
    if i >= len then error "reader/unexpected-eof" "Expected expression."
    else
      match source.[i] with
      | '(' -> parse_sequence ~open_offset:i ~close_char:')' ~kind:`List (i + 1)
      | '[' ->
          parse_sequence ~open_offset:i ~close_char:']' ~kind:`Vector (i + 1)
      | '{' -> parse_map ~open_offset:i (i + 1)
      | ')' | ']' | '}' ->
          error
            ~span:(span source_id i (i + 1))
            "reader/unexpected-close" "Unexpected closing delimiter."
      | '"' -> parse_string i
      | '\'' ->
          parse_prefixed ~prefix_start:i ~prefix_end:(i + 1) "quote" (i + 1)
      | '`' ->
          parse_prefixed ~prefix_start:i ~prefix_end:(i + 1) "quasiquote" (i + 1)
      | '~' when i + 1 < len && source.[i + 1] = '@' ->
          parse_prefixed ~prefix_start:i ~prefix_end:(i + 2) "unquote-splicing"
            (i + 2)
      | '~' ->
          parse_prefixed ~prefix_start:i ~prefix_end:(i + 1) "unquote" (i + 1)
      | _ -> parse_atom i
  and parse_prefixed ~prefix_start ~prefix_end name expr_start =
    match parse_expr expr_start with
    | Error [ { code = "reader/unexpected-eof"; _ } ] ->
        error
          ~span:(span source_id prefix_start prefix_end)
          "reader/unexpected-eof" "Expected expression."
    | Error _ as error -> error
    | Ok (expr, next) ->
        let prefix_span = span source_id prefix_start prefix_end in
        let expr_span = expr_span expr in
        Ok
          ( List
              ( span source_id prefix_start expr_span.end_offset,
                [ Symbol (prefix_span, name); expr ] ),
            next )
  and parse_sequence ~open_offset ~close_char ~kind i =
    let rec loop items i =
      let i = skip_ws i in
      if i >= len then
        error
          ~span:(span source_id open_offset (open_offset + 1))
          "reader/unclosed-sequence" "Unclosed sequence."
      else if source.[i] = close_char then
        let span = span source_id open_offset (i + 1) in
        let items = List.rev items in
        let expr =
          match kind with
          | `List -> List (span, items)
          | `Vector -> Vector (span, items)
        in
        Ok (expr, i + 1)
      else
        match parse_expr i with
        | Error _ as error -> error
        | Ok (expr, next) -> loop (expr :: items) next
    in
    loop [] i
  and parse_map ~open_offset i =
    let rec loop entries i =
      let i = skip_ws i in
      if i >= len then
        error
          ~span:(span source_id open_offset (open_offset + 1))
          "reader/unclosed-map" "Unclosed map."
      else if source.[i] = '}' then
        Ok (Map (span source_id open_offset (i + 1), List.rev entries), i + 1)
      else
        match parse_expr i with
        | Error _ as error -> error
        | Ok (key, _) when List.exists (fun (prior,_) -> match prior,key with
            | String (_,a),String (_,b) | Keyword (_,a),Keyword (_,b) -> a=b
            | _ -> false) entries ->
            error ~span:(expr_span key) "reader/duplicate-map-key" "Duplicate map key."
        | Ok (key, after_key) -> (
            let after_key = skip_ws after_key in
            if after_key >= len then
              error
                ~span:(span source_id open_offset (open_offset + 1))
                "reader/unclosed-map" "Unclosed map."
            else if source.[after_key] = '}' then
              error
                ~span:(span source_id open_offset (open_offset + 1))
                "reader/map-entry-missing-value" "Map entry is missing a value."
            else
              match parse_expr after_key with
              | Error _ as error -> error
              | Ok (value, after_value) ->
                  loop ((key, value) :: entries) after_value)
    in
    loop [] i
  in
  let rec loop exprs i =
    let i = skip_ws i in
    if i >= len then Ok (List.rev exprs)
    else
      match parse_expr i with
      | Error _ as error -> error
      | Ok (expr, next) -> loop (expr :: exprs) next
  in
  loop [] 0

let parse = parse_cst

let parse_ast ~source_id source =
  match parse_cst ~source_id source with
  | Error _ as error -> error
  | Ok cst -> Ast.of_cst cst
