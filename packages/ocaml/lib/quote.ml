type diagnostic = { code : string; message : string }

let diagnostic code message = { code; message }

let generated_span =
  Reader.{ source_id = "generated"; start_offset = 0; end_offset = 0 }

let rec value_of_syntax = function
  | Reader.Nil _ -> Value.VNil
  | Reader.Bool (_, value) -> Value.VBool value
  | Reader.Int (_, value) -> Value.VInt value
  | Reader.Float (_, value) -> Value.VFloat value
  | Reader.String (_, value) -> Value.VString value
  | Reader.Symbol (_, value) -> Value.VSymbol value
  | Reader.Keyword (_, value) -> Value.VKeyword value
  | Reader.List (_, items) -> Value.VList (List.map value_of_syntax items)
  | Reader.Vector (_, items) -> Value.VVector (List.map value_of_syntax items)
  | Reader.Map (_, entries) ->
      Value.VMap
        (List.map
           (fun (key, value) -> (value_of_syntax key, value_of_syntax value))
           entries)

let syntax_arguments : (Value.t * Ast.expr) list ref = ref []

let with_syntax_arguments expressions f =
  let previous = !syntax_arguments in
  let rec argument expression =
    let value = match expression with
      | Ast.List (_,xs) -> Value.VList (List.map argument xs)
      | Ast.Vector (_,xs) -> Value.VVector (List.map argument xs)
      | Ast.Map (_,pairs) -> Value.VMap (List.map (fun (k,v)->argument k,argument v) pairs)
      | expression -> value_of_syntax expression in
    syntax_arguments := (value,expression)::!syntax_arguments;
    value in
  Fun.protect ~finally:(fun ()->syntax_arguments:=previous) (fun ()->f (List.map argument expressions))

let rec syntax_of_value value =
  match List.find_opt (fun (original,_)->original == value) !syntax_arguments with
  | Some (_,expression) -> Ok expression
  | None -> syntax_of_generated_value value
and syntax_of_generated_value = function
  | Value.VNil -> Ok (Reader.Nil generated_span)
  | Value.VBool value -> Ok (Reader.Bool (generated_span, value))
  | Value.VInt value -> Ok (Reader.Int (generated_span, value))
  | Value.VFloat value -> Ok (Reader.Float (generated_span, value))
  | Value.VString value -> Ok (Reader.String (generated_span, value))
  | Value.VSymbol value -> Ok (Reader.Symbol (generated_span, value))
  | Value.VKeyword value -> Ok (Reader.Keyword (generated_span, value))
  | Value.VList values -> (
      match syntax_list values with
      | Error _ as error -> error
      | Ok items -> Ok (Reader.List (generated_span, items)))
  | Value.VVector values -> (
      match syntax_list values with
      | Error _ as error -> error
      | Ok items -> Ok (Reader.Vector (generated_span, items)))
  | (Value.VMap entries | Value.VDictionary entries) ->
      let rec loop acc = function
        | [] -> Ok (Reader.Map (generated_span, List.rev acc))
        | (key, value) :: rest -> (
            match (syntax_of_value key, syntax_of_value value) with
            | Ok key, Ok value -> loop ((key, value) :: acc) rest
            | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
      in
      loop [] entries
  | Value.VClosure _ | Value.VMacro _ ->
      Error
        [
          diagnostic "eval/syntax-conversion"
            "Functions and macros cannot be converted back to syntax.";
        ]

and syntax_list values =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | value :: rest -> (
        match syntax_of_value value with
        | Error _ as error -> error
        | Ok expr -> loop (expr :: acc) rest)
  in
  loop [] values

let quote = function
  | [ expr ] -> Ok (value_of_syntax expr)
  | _ -> Error [ diagnostic "eval/arity" "quote expects one argument." ]

let rec quasiquote_expr eval = function
  | Reader.List (_, [ Reader.Symbol (_, "unquote"); expr ]) -> eval expr
  | Reader.List (_, items) -> quasiquote_sequence eval ~as_vector:false items
  | Reader.Vector (_, items) -> quasiquote_sequence eval ~as_vector:true items
  | Reader.Map (_, entries) ->
      let rec loop acc = function
        | [] -> Ok (Value.VMap (List.rev acc))
        | (key_expr, value_expr) :: rest -> (
            match
              (quasiquote_expr eval key_expr, quasiquote_expr eval value_expr)
            with
            | Ok key, Ok value -> loop ((key, value) :: acc) rest
            | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
      in
      loop [] entries
  | expr -> Ok (value_of_syntax expr)

and quasiquote_sequence eval ~as_vector items =
  let rec loop acc = function
    | [] ->
        let items = List.rev acc in
        Ok (if as_vector then Value.VVector items else Value.VList items)
    | Reader.List (_, [ Reader.Symbol (_, "unquote-splicing"); expr ]) :: rest
      -> (
        match eval expr with
        | Ok (Value.VList values) | Ok (Value.VVector values) ->
            loop (List.rev_append values acc) rest
        | Ok _ ->
            Error
              [
                diagnostic "eval/quasiquote-splice"
                  "unquote-splicing expects a list or vector value.";
              ]
        | Error _ as error -> error)
    | item :: rest -> (
        match quasiquote_expr eval item with
        | Error _ as error -> error
        | Ok value -> loop (value :: acc) rest)
  in
  loop [] items

let quasiquote ~eval = function
  | [ expr ] -> quasiquote_expr eval expr
  | _ -> Error [ diagnostic "eval/arity" "quasiquote expects one argument." ]
