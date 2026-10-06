module Abi = Forma_ocaml.Abi
module Abi_request = Forma_ocaml.Abi_request
module Abi_session_ops = Forma_ocaml.Abi_session_ops
module Session = Forma_ocaml.Session
module Type_diagnostic = Forma_ocaml.Type_diagnostic
module Typecheck = Forma_ocaml.Typecheck
module Value = Forma_ocaml.Value

let usage () =
  "Usage:\n\
  \  forma-ocaml request '<json>'\n\
  \  forma-ocaml daemon\n\
  \  forma-ocaml file <typecheck|evaluate|interface|declarations> <entry.forma>\n\
  \  forma-ocaml repl\n\
  \  forma-ocaml version\n"

let read_all_stdin () =
  let buffer = Buffer.create 256 in
  (try
     while true do
       Buffer.add_string buffer (input_line stdin);
       Buffer.add_char buffer '\n'
     done
   with End_of_file -> ());
  Buffer.contents buffer

let print_json json =
  print_endline json;
  flush stdout

let print_error message =
  prerr_endline message;
  flush stderr

let rec render_value = function
  | Value.VNil -> "nil"
  | Value.VBool true -> "true"
  | Value.VBool false -> "false"
  | Value.VInt value -> string_of_int value
  | Value.VFloat value -> string_of_float value
  | Value.VString value -> Printf.sprintf "%S" value
  | Value.VSymbol value -> value
  | Value.VKeyword value -> value
  | Value.VList values ->
      "(" ^ String.concat " " (List.map render_value values) ^ ")"
  | Value.VVector values ->
      "[" ^ String.concat " " (List.map render_value values) ^ "]"
  | Value.VMap entries | Value.VDictionary entries ->
      let render_entry (key, value) =
        render_value key ^ " " ^ render_value value
      in
      "{" ^ String.concat " " (List.map render_entry entries) ^ "}"
  | Value.VClosure _ -> "<function>"
  | Value.VMacro _ -> "<macro>"

let render_type_diagnostic (diagnostic : Type_diagnostic.t) = diagnostic.message

let print_repl_diagnostics = function
  | Abi_session_ops.Repl_reader diagnostics ->
      List.iter
        (fun diagnostic -> print_error diagnostic.Forma_ocaml.Cst.message)
        diagnostics
  | Abi_session_ops.Repl_eval diagnostics ->
      List.iter
        (fun diagnostic -> print_error diagnostic.Forma_ocaml.Eval.message)
        diagnostics
  | Abi_session_ops.Repl_typecheck diagnostics ->
      List.iter
        (fun diagnostic -> print_error (render_type_diagnostic diagnostic))
        diagnostics

type balance = {
  parens : int;
  brackets : int;
  braces : int;
  in_string : bool;
  escaped : bool;
}

let empty_balance =
  { parens = 0; brackets = 0; braces = 0; in_string = false; escaped = false }

let update_balance balance line =
  let len = String.length line in
  let rec loop index balance =
    if index >= len then balance
    else if balance.in_string then
      if balance.escaped then loop (index + 1) { balance with escaped = false }
      else
        match line.[index] with
        | '\\' -> loop (index + 1) { balance with escaped = true }
        | '"' -> loop (index + 1) { balance with in_string = false }
        | _ -> loop (index + 1) balance
    else
      match line.[index] with
      | ';' -> balance
      | '"' ->
          loop (index + 1) { balance with in_string = true; escaped = false }
      | '(' -> loop (index + 1) { balance with parens = balance.parens + 1 }
      | ')' -> loop (index + 1) { balance with parens = balance.parens - 1 }
      | '[' -> loop (index + 1) { balance with brackets = balance.brackets + 1 }
      | ']' -> loop (index + 1) { balance with brackets = balance.brackets - 1 }
      | '{' -> loop (index + 1) { balance with braces = balance.braces + 1 }
      | '}' -> loop (index + 1) { balance with braces = balance.braces - 1 }
      | _ -> loop (index + 1) balance
  in
  loop 0 balance

let balance_complete balance =
  (not balance.in_string) && balance.parens <= 0 && balance.brackets <= 0
  && balance.braces <= 0

let trim text =
  let len = String.length text in
  let rec left index =
    if index >= len then len
    else
      match text.[index] with
      | ' ' | '\n' | '\r' | '\t' -> left (index + 1)
      | _ -> index
  in
  let rec right index =
    if index < 0 then -1
    else
      match text.[index] with
      | ' ' | '\n' | '\r' | '\t' -> right (index - 1)
      | _ -> index
  in
  let start = left 0 in
  let finish = right (len - 1) in
  if finish < start then "" else String.sub text start (finish - start + 1)

let read_repl_form () =
  let buffer = Buffer.create 128 in
  let rec loop balance continuation =
    print_string (if continuation then ".. " else "oo> ");
    flush stdout;
    match input_line stdin with
    | exception End_of_file ->
        if Buffer.length buffer = 0 then None else Some (Buffer.contents buffer)
    | line ->
        Buffer.add_string buffer line;
        Buffer.add_char buffer '\n';
        let balance = update_balance balance line in
        if balance_complete balance then Some (Buffer.contents buffer)
        else loop balance true
  in
  loop empty_balance false

let submit_source session ?source_id source =
  Abi_session_ops.submit_repl session ~source_id ~source

let handle_meta_command session line =
  let trimmed = trim line in
  if trimmed = ":quit" || trimmed = ":q" then `Quit
  else if trimmed = ":help" then (
    print_endline ":quit  exit";
    print_endline ":reset reset session bindings";
    print_endline ":load  load file contents into the current session";
    `Continue)
  else if trimmed = ":reset" then (
    Session.reset session;
    print_endline "Session reset.";
    `Continue)
  else if String.length trimmed > 6 && String.sub trimmed 0 6 = ":load " then (
    let path = trim (String.sub trimmed 6 (String.length trimmed - 6)) in
    if path = "" then (
      print_error "Usage: :load <path>";
      `Continue)
    else
      let source =
        try
          let channel = open_in path in
          Fun.protect
            ~finally:(fun () -> close_in channel)
            (fun () ->
              let length = in_channel_length channel in
              really_input_string channel length)
        with Sys_error message ->
          print_error message;
          ""
      in
      if source = "" then `Continue
      else
        match submit_source session ~source_id:path source with
        | Ok result ->
            print_endline (render_value result.value);
            print_endline (": " ^ result.typ);
            `Continue
        | Error error ->
            print_repl_diagnostics error;
            `Continue)
  else `NotACommand

let run_repl () =
  let session = Session.open_ () in
  print_endline "Forma OCaml REPL";
  print_endline "Type :help for commands.";
  let rec loop () =
    match read_repl_form () with
    | None ->
        Session.close session;
        ()
    | Some input -> (
        let source = trim input in
        if source = "" then loop ()
        else
          match handle_meta_command session source with
          | `Quit ->
              Session.close session;
              ()
          | `Continue -> loop ()
          | `NotACommand ->
              (match submit_source session source with
              | Ok result ->
                  print_endline (render_value result.value);
                  print_endline (": " ^ result.typ)
              | Error error -> print_repl_diagnostics error);
              loop ())
  in
  loop ()

(* Filesystem resolution is a CLI adapter, outside the universal compiler library. *)
let run_file operation path =
  let module Graph = Forma_ocaml.Module_graph in
  let read path =
    let id=Unix.realpath path in
    let channel=open_in_bin id in
    let source=Fun.protect ~finally:(fun ()->close_in channel) (fun ()->really_input_string channel (in_channel_length channel)) in
    Graph.{id;source} in
  try
    let entry=read path in
    let resolver ~specifier ~importer =
      try Some (read (Filename.concat (Filename.dirname importer) specifier)) with Sys_error _ | Unix.Unix_error _ -> None in
    match Graph.resolve entry resolver with
    | Error diagnostics -> print_json (Forma_ocaml.Abi_response.typecheck_diagnostics_json diagnostics)
    | Ok graph ->
      let session=Session.open_ () in
      Fun.protect ~finally:(fun ()->Session.close session) (fun ()->
        List.iter (fun (m : Graph.resolved_module)->Hashtbl.replace session.sources m.id (Forma_ocaml.Source.make ~id:m.id ~text:m.source ())) graph.modules;
        let op=match operation with "typecheck" -> "typecheckModule" | "evaluate" -> "evaluateModule" | "declarations" -> "moduleDeclarations" | "interface" -> "moduleGraph" | _ -> invalid_arg "file operation must be typecheck, evaluate, interface, or declarations" in
        print_json (Abi.handle_json (Printf.sprintf "{\"op\":%s,\"sessionId\":%s,\"sourceId\":%s}" (Value.string_json op) (Value.string_json session.id) (Value.string_json entry.id))))
  with Sys_error message | Invalid_argument message -> print_error message; exit 1
     | Unix.Unix_error (error,_,_) -> print_error (Unix.error_message error); exit 1

let () =
  let argv = Sys.argv in
  let argc = Array.length argv in
  match if argc > 1 then argv.(1) else "" with
  | "version" -> print_json (Abi.handle_json "{\"op\":\"version\"}")
  | "daemon" -> (
      try
        while true do
          let input = input_line stdin in
          print_json (Abi.handle_json input)
        done
      with End_of_file -> ())
  | "file" when argc = 4 -> run_file argv.(2) argv.(3)
  | "repl" -> run_repl ()
  | "request" ->
      let input = if argc > 2 then argv.(2) else read_all_stdin () in
      print_json (Abi.handle_json input)
  | _ ->
      prerr_string (usage ());
      exit 64
