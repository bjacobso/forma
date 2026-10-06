type t =
  | VNil
  | VBool of bool
  | VInt of int
  | VFloat of float
  | VString of string
  | VSymbol of string
  | VKeyword of string
  | VList of t list
  | VVector of t list
  | VMap of (t * t) list
  | VDictionary of (t * t) list
  | VClosure of closure
  | VMacro of closure

and closure = {
  params : string list;
  rest_param : string option;
  body : Ast.expr list;
  env : (string * t) list;
}

let json_escape input =
  let buffer = Buffer.create (String.length input + 16) in
  String.iter
    (function
      | '"' -> Buffer.add_string buffer "\\\""
      | '\\' -> Buffer.add_string buffer "\\\\"
      | '\b' -> Buffer.add_string buffer "\\b"
      | '\012' -> Buffer.add_string buffer "\\f"
      | '\n' -> Buffer.add_string buffer "\\n"
      | '\r' -> Buffer.add_string buffer "\\r"
      | '\t' -> Buffer.add_string buffer "\\t"
      | c when Char.code c < 0x20 ->
          Buffer.add_string buffer (Printf.sprintf "\\u%04x" (Char.code c))
      | c -> Buffer.add_char buffer c)
    input;
  Buffer.contents buffer

let string_json value = Printf.sprintf "\"%s\"" (json_escape value)

let rec to_json = function
  | VNil -> "{\"kind\":\"nil\"}"
  | VBool value ->
      Printf.sprintf "{\"kind\":\"bool\",\"value\":%s}" (string_of_bool value)
  | VInt value -> Printf.sprintf "{\"kind\":\"int\",\"value\":%d}" value
  | VFloat value ->
      Printf.sprintf "{\"kind\":\"float\",\"value\":%s}" (string_of_float value)
  | VString value ->
      Printf.sprintf "{\"kind\":\"string\",\"value\":%s}" (string_json value)
  | VSymbol value ->
      Printf.sprintf "{\"kind\":\"symbol\",\"value\":%s}" (string_json value)
  | VKeyword value ->
      Printf.sprintf "{\"kind\":\"keyword\",\"value\":%s}" (string_json value)
  | VList items ->
      Printf.sprintf "{\"kind\":\"list\",\"items\":[%s]}"
        (String.concat "," (List.map to_json items))
  | VVector items ->
      Printf.sprintf "{\"kind\":\"vector\",\"items\":[%s]}"
        (String.concat "," (List.map to_json items))
  | (VMap entries | VDictionary entries) ->
      let entry_to_json (key, value) =
        Printf.sprintf "{\"key\":%s,\"value\":%s}" (to_json key) (to_json value)
      in
      Printf.sprintf "{\"kind\":\"map\",\"entries\":[%s]}"
        (String.concat "," (List.map entry_to_json entries))
  | VClosure _ -> "{\"kind\":\"function\"}"
  | VMacro _ -> "{\"kind\":\"macro\"}"

let truthy = function VNil | VBool false -> false | _ -> true

(* Runtime equality, shared with the TypeScript engine: numbers compare by
   value (1 equals 1.0), lists and vectors are one sequence representation,
   and a function equals only itself. Never use polymorphic equality on
   values: closures may hold cyclic environments. *)
let rec equal left right =
  match (left, right) with
  | VNil, VNil -> true
  | VBool left, VBool right -> left = right
  | VInt left, VInt right -> left = right
  | VFloat left, VFloat right -> left = right
  | VInt left, VFloat right | VFloat right, VInt left -> Float.of_int left = right
  | (VClosure _ | VMacro _), (VClosure _ | VMacro _) -> left == right
  | VString left, VString right -> left = right
  | VSymbol left, VSymbol right -> left = right
  | VKeyword left, VKeyword right -> left = right
  | (VList left | VVector left), (VList right | VVector right) ->
      List.length left = List.length right && List.for_all2 equal left right
  | (VMap left | VDictionary left), (VMap right | VDictionary right) ->
      List.length left = List.length right
      && List.for_all
           (fun (left_key, left_value) ->
             match
               List.find_opt
                 (fun (right_key, _) -> equal left_key right_key)
                 right
             with
             | Some (_, right_value) -> equal left_value right_value
             | None -> false)
           left
  | _ -> false

let to_str_part = function
  | VNil -> "nil"
  | VBool value -> string_of_bool value
  | VInt value -> string_of_int value
  | VFloat value -> string_of_float value
  | VString value -> value
  | VSymbol value -> value
  | VKeyword value -> value
  | VList _ -> "<list>"
  | VVector _ -> "<vector>"
  | (VMap _ | VDictionary _) -> "<map>"
  | VClosure _ -> "<function>"
  | VMacro _ -> "<macro>"

let to_format_part = function VNil -> "" | value -> to_str_part value

let concat_string values =
  VString (String.concat "" (List.map to_str_part values))

let key_candidates = function
  | VString key when String.length key > 0 && key.[0] = ':' ->
      [
        VString key;
        VKeyword key;
        VSymbol (String.sub key 1 (String.length key - 1));
      ]
  | VString key -> [ VString key; VKeyword (":" ^ key); VSymbol key ]
  | VSymbol key -> [ VSymbol key; VKeyword (":" ^ key); VString key ]
  | VKeyword key when String.length key > 0 && key.[0] = ':' ->
      [
        VKeyword key;
        VString key;
        VSymbol (String.sub key 1 (String.length key - 1));
      ]
  | key -> [ key ]

let lookup_map entries key =
  let candidates = key_candidates key in
  List.find_map
    (fun candidate ->
      match
        List.find_opt (fun (entry_key, _) -> equal entry_key candidate) entries
      with
      | Some (_, value) -> Some value
      | None -> None)
    candidates

let length_key = function
  | VString "length" | VSymbol "length" | VKeyword ":length" -> true
  | _ -> false

let lookup_path_segment value key =
  match (value, key) with
  | (VMap entries | VDictionary entries), key -> (
      match List.find_opt (fun (k,_) -> equal k key) entries with Some (_,value) -> value | None -> VNil)
  | VList values, VInt index | VVector values, VInt index ->
      if index < 0 || index >= List.length values then VNil
      else List.nth values index
  | (VList values, key | VVector values, key) when length_key key ->
      VInt (List.length values)
  | VString value, key when length_key key -> VInt (String.length value)
  | _ -> VNil
