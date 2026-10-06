type options = { soft_wrap : int; indent_size : int }

let default_options = { soft_wrap = 80; indent_size = 2 }

let escape_string input =
  let buffer = Buffer.create (String.length input + 16) in
  String.iter
    (function
      | '"' -> Buffer.add_string buffer "\\\""
      | '\\' -> Buffer.add_string buffer "\\\\"
      | '\n' -> Buffer.add_string buffer "\\n"
      | c -> Buffer.add_char buffer c)
    input;
  Buffer.contents buffer

let rec flat = function
  | Ast.Nil _ -> "nil"
  | Ast.Bool (_, value) -> string_of_bool value
  | Ast.Int (_, value) -> string_of_int value
  | Ast.Float (_, value) -> string_of_float value
  | Ast.String (_, value) -> Printf.sprintf "\"%s\"" (escape_string value)
  | Ast.Symbol (_, value) | Ast.Keyword (_, value) -> value
  | Ast.List (_, items) ->
      Printf.sprintf "(%s)" (String.concat " " (List.map flat items))
  | Ast.Vector (_, items) ->
      Printf.sprintf "[%s]" (String.concat " " (List.map flat items))
  | Ast.Map (_, entries) ->
      let entry (key, value) = Printf.sprintf "%s %s" (flat key) (flat value) in
      Printf.sprintf "{%s}" (String.concat " " (List.map entry entries))

let rec format_expr options patterns indent expr =
  let one_line = flat expr in
  if indent + String.length one_line <= options.soft_wrap then
    String.make indent ' ' ^ one_line
  else
    match expr with
    | Ast.List (_, []) -> String.make indent ' ' ^ "()"
    | Ast.List (_, head :: rest) ->
        let child_indent = indent + options.indent_size in
        let pattern=match head with Ast.Symbol (_,n)->List.assoc_opt n patterns | _->None in
        let lines=match pattern with
          | None -> (String.make indent ' ' ^ "(" ^ flat head) :: List.map (format_expr options patterns child_indent) rest
          | Some pattern ->
              let rec positional = function Ast.Map _ :: _ | _ :: Ast.Symbol (_,"...") :: _ | [] -> 0 | _ :: rest -> 1+positional rest in
              let rec header count prefix = function
                | item :: rest when count>0 && String.length prefix+1+String.length (flat item)<=options.soft_wrap -> header (count-1) (prefix ^ " " ^ flat item) rest
                | rest -> prefix,rest in
              let prefix,rest=header (positional pattern) (String.make indent ' ' ^ "(" ^ flat head) rest in
              let rec rows = function
                | (Ast.Keyword (_,key) | Ast.Symbol (_,key)) :: value :: rest when String.starts_with ~prefix:":" key ->
                    let inline=String.make child_indent ' ' ^ key ^ " " ^ flat value in
                    (if String.length inline<=options.soft_wrap then [inline] else [String.make child_indent ' ' ^ key;format_expr options patterns (child_indent+options.indent_size) value]) @ rows rest
                | item :: rest -> format_expr options patterns child_indent item :: rows rest
                | [] -> [] in
              prefix :: rows rest in
        close_last ")" lines
    | Ast.Vector (_, []) -> String.make indent ' ' ^ "[]"
    | Ast.Vector (_, items) ->
        let child_indent = indent + options.indent_size in
        close_last "]"
          ((String.make indent ' ' ^ "[")
          :: List.map (format_expr options patterns child_indent) items)
    | Ast.Map (_, []) -> String.make indent ' ' ^ "{}"
    | Ast.Map (_, entries) ->
        let child_indent = indent + options.indent_size in
        let entry_lines (key, value) =
          let key_text = flat key in
          let value_text = flat value in
          if
            child_indent + String.length key_text + 1 + String.length value_text
            <= options.soft_wrap
          then [ String.make child_indent ' ' ^ key_text ^ " " ^ value_text ]
          else
            [
              String.make child_indent ' ' ^ key_text;
              format_expr options patterns (child_indent + options.indent_size) value;
            ]
        in
        close_last "}"
          ((String.make indent ' ' ^ "{") :: List.concat_map entry_lines entries)
    | Ast.Nil _ | Ast.Bool _ | Ast.Int _ | Ast.Float _ | Ast.String _
    | Ast.Symbol _ | Ast.Keyword _ ->
        String.make indent ' ' ^ one_line

and close_last suffix = function
  | [] -> suffix
  | lines ->
      let rec loop acc = function
        | [] -> List.rev acc
        | [ last ] -> List.rev ((last ^ suffix) :: acc)
        | line :: rest -> loop (line :: acc) rest
      in
      String.concat "\n" (loop [] lines)

let format_program ?(options = default_options) ?(env=Env.empty) exprs =
  let patterns=List.filter_map (fun (n,v) ->
    if String.starts_with ~prefix:"__form/" n then match Quote.syntax_of_value v with
      | Ok (Ast.List (_,Ast.Symbol (_,n) :: args)) -> Some (n,args) | _ -> None else None) (Env.bindings env) in
  let patterns=List.fold_left (fun patterns -> function
    | Ast.List (_,Ast.Symbol (_,"form") :: Ast.List (_,Ast.Symbol (_,n) :: args) :: _) -> (n,args) :: List.remove_assoc n patterns
    | _ -> patterns) patterns exprs in
  match exprs with
  | [] -> ""
  | _ -> String.concat "\n" (List.map (format_expr options patterns 0) exprs) ^ "\n"

(* Comments attach to the next authored token. Tree alignment handles shorthand
   that the pretty-printer expands, without mistaking semicolons in strings. *)
let restore_comments options source original rendered =
  let length=String.length source in
  let rec scan index quoted escaped acc =
    if index>=length then List.rev acc else
    let ch=source.[index] in
    if quoted then scan (index+1) (ch<>'"' || escaped) (ch='\\' && not escaped) acc
    else if ch='"' then scan (index+1) true false acc
    else if ch=';' then
      let rec finish at=if at<length && source.[at]<>'\n' then finish (at+1) else at in
      let ending=finish index in scan ending false false ((ending,String.sub source index (ending-index)) :: acc)
    else scan (index+1) false false acc in
  let comments=scan 0 false false [] in
  if comments=[] then rendered else match Reader.parse_ast ~source_id:"formatted" rendered with
  | Error _ -> rendered
  | Ok formatted ->
      let anchors=ref [] in
      let children = function Ast.List (_,items) | Ast.Vector (_,items) -> items | Ast.Map (_,fields) -> List.concat_map (fun (k,v)->[k;v]) fields | _ -> [] in
      let rec pair indent a b =
        let sa=Ast.expr_span a and sb=Ast.expr_span b in
        anchors := (sa.start_offset,sb.start_offset,indent) :: !anchors;
        let ac=children a and bc=children b in
        if ac<>[] then anchors := (sa.end_offset-1,sb.end_offset-1,indent) :: !anchors;
        if List.length ac=List.length bc then List.iter2 (pair (indent+options.indent_size)) ac bc in
      if List.length original=List.length formatted then List.iter2 (pair 0) original formatted;
      let anchors=List.sort (fun (a,_,_) (b,_,_)->compare a b) !anchors in
      let groups=List.fold_left (fun groups (ending,comment)->
        let target,indent=match List.find_opt (fun (start,_,_)->start>=ending) anchors with Some (_,target,indent)->target,indent | None -> String.length rendered,0 in
        let previous=Option.value ~default:(indent,[]) (List.assoc_opt target groups) in
        (target,(fst previous,snd previous @ [comment])) :: List.remove_assoc target groups) [] comments in
      let rendered=List.fold_left (fun text (offset,(indent,comments))->
        let prefix=String.sub text 0 offset and suffix=String.sub text offset (String.length text-offset) in
        let pad=String.make indent ' ' in
        prefix ^ (if String.trim prefix="" then "" else "\n") ^ String.concat "\n" (List.map (fun c->pad ^ c) comments) ^ "\n" ^ pad ^ suffix)
        rendered (List.sort (fun (a,_) (b,_)->compare b a) groups) in
      let trim_right line =
        let rec finish i=if i>=0 && (line.[i]=' ' || line.[i]='\t') then finish (i-1) else i+1 in
        String.sub line 0 (finish (String.length line-1)) in
      String.trim (String.concat "\n" (List.map trim_right (String.split_on_char '\n' rendered))) ^ "\n"

let format_source ?(options=default_options) ?(env=Env.empty) source exprs =
  restore_comments options source exprs (format_program ~options ~env exprs)
