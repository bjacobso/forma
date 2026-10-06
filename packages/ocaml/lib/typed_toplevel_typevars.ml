let builtin_type_names =
  [
    "Int";
    "Num";
    "Float";
    "Bool";
    "Str";
    "String";
    "Nil";
    "Unit";
    "Keyword";
    "Symbol";
    "Syntax";
    "Any";
    "_";
    "List";
    "Vector";
    "Map";
  ]

let lowercase_initial name =
  String.length name > 0
  &&
  let first = name.[0] in
  Char.lowercase_ascii first = first && Char.uppercase_ascii first <> first

let rec collect_implicit acc = function
  | Core_ast.TESym (_, name)
    when lowercase_initial name && not (List.mem name ("true" :: "false" :: builtin_type_names)) ->
      name :: acc
  | Core_ast.TESym _ -> acc
  | Core_ast.TEFun (_, params, result) ->
      List.fold_left collect_implicit (collect_implicit acc result) params
  | Core_ast.TEApp (_, callee, args) ->
      List.fold_left collect_implicit (collect_implicit acc callee) args
  | Core_ast.TERow (_, fields, row) ->
      List.fold_left (fun acc (_, ty) -> collect_implicit acc ty) (match row with Some n -> n :: acc | None -> acc) fields
