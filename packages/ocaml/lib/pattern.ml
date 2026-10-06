type bindings = (string * Value.t) list

let rec match_value ?(constructor_spec=(fun _ -> None)) pattern value =
  let tag n = match constructor_spec n with Some (Value.VMap spec) -> (match Value.lookup_map spec (Value.VKeyword ":discriminator") with Some (Value.VString key) -> ":" ^ key | _ -> ":_tag") | _ -> ":_tag" in
  let matches_constructor name entries =
    let class_record = match constructor_spec name with Some (Value.VMap spec) -> Value.lookup_map spec (Value.VKeyword ":class") = Some (Value.VBool true) | _ -> false in
    class_record || Value.lookup_map entries (Value.VKeyword (tag name)) = Some (Value.VString (List.hd (List.rev (String.split_on_char '.' name)))) in
  match (pattern, value) with
  | Reader.Symbol (_, "_"), _ -> Some []
  | Reader.Symbol (_, name), Value.VMap entries when Surface.is_upper name ->
      (match Value.lookup_map entries (Value.VKeyword (tag name)) with
       | _ when matches_constructor name entries -> Some [] | _ -> None)
  | Reader.Symbol (_, name), value when not (Surface.is_upper name) -> Some [ (name, value) ]
  | Reader.List (_, Reader.Symbol (_, name) :: patterns), Value.VMap entries when Surface.is_upper name ->
      (match Value.lookup_map entries (Value.VKeyword (tag name)) with
       | _ when matches_constructor name entries ->
         let record = match constructor_spec name with Some (Value.VMap spec) -> Value.lookup_map spec (Value.VKeyword ":record") = Some (Value.VBool true) | _ -> false in
         let payload = if record then [value] else match patterns with [] -> [] | [_] -> [Option.value ~default:Value.VNil (Value.lookup_map entries (Value.VKeyword ":value"))] | _ -> (match Value.lookup_map entries (Value.VKeyword ":values") with Some (Value.VVector values) -> values | _ -> []) in
         match_list ~constructor_spec patterns payload
       | _ -> None)
  | Reader.Map (_, patterns), Value.VMap entries ->
      let as_pattern = List.find_map (function Reader.Keyword (_,":as"),p -> Some p | _ -> None) patterns in
      let patterns = List.filter (function Reader.Keyword (_,":as"),_ -> false | _ -> true) patterns in
      let patterns = List.concat_map (function
        | Reader.Keyword (_, ":keys"), Reader.Vector (_, keys) -> List.map (fun key -> match key with Reader.Symbol (s,n) -> (Reader.Keyword (s,":" ^ n), key) | _ -> (key,key)) keys
        | pair -> [pair]) patterns in
      let rec loop bindings = function
        | [] -> Some bindings
        | (key, pattern) :: rest ->
            (match Quote.quote [key] with
             | Error _ -> None
             | Ok key -> (match Value.lookup_map entries key with
               | None -> None
               | Some value -> match match_value ~constructor_spec pattern value with
                 | None -> None | Some next -> (match merge bindings next with Some bindings -> loop bindings rest | None -> None)))
      in (match as_pattern with None -> loop [] patterns | Some p -> (match match_value ~constructor_spec p value with None -> None | Some bindings -> loop bindings patterns))
  | Reader.Nil _, Value.VNil -> Some []
  | Reader.Bool (_, left), Value.VBool right when left = right -> Some []
  | Reader.Int (_, left), Value.VInt right when left = right -> Some []
  | Reader.Float (_, left), Value.VFloat right when left = right -> Some []
  | Reader.String (_, left), Value.VString right when left = right -> Some []
  | Reader.Keyword (_, left), Value.VKeyword right when left = right -> Some []
  | Reader.List (_, patterns), Value.VList values
  | Reader.Vector (_, patterns), Value.VVector values
  | Reader.Vector (_, patterns), Value.VList values
  | Reader.List (_, patterns), Value.VVector values ->
      match_list ~constructor_spec patterns values
  | _ -> None

and merge left right =
  if List.exists (fun (n,v) -> match List.assoc_opt n left with Some other -> other <> v | None -> false) right then None
  else Some (right @ left)

and match_list ~constructor_spec patterns values =
    let rec loop bindings patterns values =
      match (patterns, values) with
      | [], [] -> Some bindings
      | [Reader.Symbol (_, "&"); Reader.Symbol (_, name)], values -> merge bindings [name, Value.VVector values]
      | pattern :: rest_patterns, value :: rest_values -> (
          match match_value ~constructor_spec pattern value with
          | Some next_bindings ->
              (match merge bindings next_bindings with Some bindings -> loop bindings rest_patterns rest_values | None -> None)
          | None -> None)
      | _ -> None
    in
    loop [] patterns values
