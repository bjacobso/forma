(* Stable JavaScript entry point; consumers never index an OCaml module block. *)
let () =
  Js_of_ocaml.Js.export "formaOcaml"
    (Js_of_ocaml.Js.Unsafe.obj
       [| ("handleJson", Js_of_ocaml.Js.Unsafe.inject
             (Js_of_ocaml.Js.wrap_callback (fun request ->
                  Js_of_ocaml.Js.string
                    (Forma_ocaml.Abi.handle_json (Js_of_ocaml.Js.to_string request))))) |])

let request =
  if Array.length Sys.argv > 1 then Sys.argv.(1) else "{\"op\":\"version\"}"

let () = print_endline (Forma_ocaml.Abi.handle_json request)
