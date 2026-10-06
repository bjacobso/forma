type value = Value.t =
  | VNil
  | VBool of bool
  | VInt of int
  | VFloat of float
  | VString of string
  | VSymbol of string
  | VKeyword of string
  | VList of value list
  | VVector of value list
  | VMap of (value * value) list
  | VDictionary of (value * value) list
  | VClosure of Value.closure
  | VMacro of Value.closure

type alias = { name : string; to_name : string; component_name : string option }

let scalar_string = Eval_slot.scalar_string
let keyword key = VKeyword key

let normalize_name name =
  if String.length name > 0 && name.[0] = ':' then
    String.sub name 1 (String.length name - 1)
  else name

let key_string = function
  | VKeyword name | VSymbol name | VString name -> Some (normalize_name name)
  | value -> scalar_string value |> Option.map normalize_name

let rec rewrite ~component_name_prop_field aliases value =
  let inject_component_name component_name args =
    let rec replace_first_map = function
      | [] -> (false, [])
      | VMap entries :: rest ->
          let filtered_entries =
            List.filter
              (fun (key, _) -> key_string key <> Some component_name_prop_field)
              entries
          in
          ( true,
            VMap
              (( keyword (":" ^ component_name_prop_field),
                 VString component_name )
              :: filtered_entries)
            :: rest )
      | item :: rest ->
          let replaced, rest' = replace_first_map rest in
          (replaced, item :: rest')
    in
    let replaced, args' = replace_first_map args in
    if replaced then args'
    else
      VMap
        [ (keyword (":" ^ component_name_prop_field), VString component_name) ]
      :: args'
  in
  match value with
  | VList (head :: args) -> (
      let rewritten_args =
        List.map (rewrite ~component_name_prop_field aliases) args
      in
      match scalar_string head with
      | Some form_name -> (
          match List.find_opt (fun alias -> alias.name = form_name) aliases with
          | Some alias ->
              let rewritten_args =
                match alias.component_name with
                | Some component_name ->
                    inject_component_name component_name rewritten_args
                | None -> rewritten_args
              in
              VList (VSymbol alias.to_name :: rewritten_args)
          | None -> VList (head :: rewritten_args))
      | None ->
          VList
            (List.map
               (rewrite ~component_name_prop_field aliases)
               (head :: args)))
  | VList [] -> VList []
  | VVector values ->
      VVector (List.map (rewrite ~component_name_prop_field aliases) values)
  | VMap entries ->
      VMap
        (List.map
           (fun (key, value) ->
             (key, rewrite ~component_name_prop_field aliases value))
           entries)
  | value -> value
