(* Time the public JSON ABI inside one process, excluding pipe round trips.
   Protocol: "warmup batch samples", then one JSON request, repeated until EOF. *)
let () =
  print_endline "{\"ready\":true}";
  try
    while true do
      let config = read_line () in
      let warmup, batch, samples =
        Scanf.sscanf config "%d %d %d" (fun a b c -> (a, b, c))
      in
      let request = read_line () in
      let run () = Forma_ocaml.Abi.handle_json request in
      let response = ref (run ()) in
      for _ = 1 to warmup do response := run () done;
      let times =
        List.init samples (fun _ ->
            let started = Unix.gettimeofday () in
            for _ = 1 to batch do response := run () done;
            (Unix.gettimeofday () -. started) *. 1000. /. float_of_int batch)
      in
      Printf.printf "{\"response\":%s,\"samplesMs\":[%s]}\n%!" !response
        (String.concat "," (List.map (Printf.sprintf "%.9f") times))
    done
  with End_of_file -> ()
