module String_map = Map.Make (String)

type t = { bindings : (string * Value.t) list; index : Value.t String_map.t }

let empty = { bindings = []; index = String_map.empty }
let lookup name env = String_map.find_opt name env.index

let bind name value env =
  {
    bindings = (name, value) :: env.bindings;
    index = String_map.add name value env.index;
  }

let extend bindings env =
  {
    bindings = bindings @ env.bindings;
    index =
      List.fold_right
        (fun (name, value) index -> String_map.add name value index)
        bindings env.index;
  }

let bindings env = env.bindings
let visible_bindings env = String_map.bindings env.index
let of_bindings bindings = extend bindings empty
let length env = List.length env.bindings

let remove_names names env =
  env.bindings
  |> List.filter (fun (name, _) -> not (List.mem name names))
  |> of_bindings
