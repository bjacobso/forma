(* Canonical artifact metadata only. Executable file imports, binding identity,
   and diagnostics are resolved by Module_graph; this analyzer never rewrites
   source aliases or publishes source bindings into a session. *)
type module_use = { prelude : string }

type module_import = {
  specifier : string;
  resolved_path : string option;
  module_id : string option;
  mode : string;
  alias : string option;
  names : string list;
}

type module_re_export = {
  specifier : string;
  resolved_path : string option;
  module_id : string option;
  names : string list;
}

type alias_reference = { alias : string; local_name : string }

type module_diagnostic = { code : string; message : string }

type t = {
  module_id : string;
  source_path : string;
  used_preludes : module_use list;
  imports : module_import list;
  explicit_exports : string list;
  re_exports : module_re_export list;
  diagnostics : module_diagnostic list;
  alias_references : alias_reference list;
  unqualified_references : string list;
}

type declaration = {
  local_name : string;
  kind : string;
  canonical_name : string;
}

type analysis = { decl : t; source_exprs : Ast.expr list }

let directive_heads = [ "use"; "import"; "export"; "export-from" ]

let normalize_path path =
  let has_leading_slash = String.length path > 0 && path.[0] = '/' in
  let parts =
    String.split_on_char '/' (String.map (function '\\' -> '/' | c -> c) path)
  in
  let rec loop acc = function
    | [] -> List.rev acc
    | "" :: rest | "." :: rest -> loop acc rest
    | ".." :: rest -> loop (match acc with [] -> [] | _ :: tail -> tail) rest
    | part :: rest -> loop (part :: acc) rest
  in
  let normalized = String.concat "/" (loop [] parts) in
  if has_leading_slash then if normalized = "" then "/" else "/" ^ normalized
  else normalized

let dirname path =
  match List.rev (String.split_on_char '/' (normalize_path path)) with
  | [] | [ _ ] -> ""
  | _ :: rest -> String.concat "/" (List.rev rest)

let scalar_name = function
  | Ast.Symbol (_, name) | Ast.Keyword (_, name) | Ast.String (_, name) ->
      Some name
  | _ -> None

let is_keywordish name = function
  | Ast.Symbol (_, value) | Ast.Keyword (_, value) -> value = name
  | _ -> false

let resolve_specifier ~source_id ~known_source_ids specifier =
  if not (String.starts_with ~prefix:"." specifier) then (None, None)
  else
    let base = dirname source_id in
    let resolved_path =
      normalize_path (if base = "" then specifier else base ^ "/" ^ specifier)
    in
    let module_id =
      if List.mem resolved_path known_source_ids then Some resolved_path
      else None
    in
    (Some resolved_path, module_id)

let parse_use args =
  match args with
  | [ prelude ] -> (
      match scalar_name prelude with
      | Some prelude -> Ok { prelude }
      | None -> Error "use expects one prelude name.")
  | _ -> Error "use expects one prelude name."

let parse_import ~source_id ~known_source_ids args =
  match args with
  | [ specifier_expr; mode_expr; alias_expr ] when is_keywordish ":as" mode_expr
    -> (
      match (scalar_name specifier_expr, scalar_name alias_expr) with
      | Some specifier, Some alias ->
          let resolved_path, module_id =
            resolve_specifier ~source_id ~known_source_ids specifier
          in
          Ok
            {
              specifier;
              resolved_path;
              module_id;
              mode = "alias";
              alias = Some alias;
              names = [];
            }
      | _ -> Error "alias import expects :as and an alias.")
  | [ specifier_expr; Ast.Vector (_, name_exprs) ] -> (
      match scalar_name specifier_expr with
      | None -> Error "import expects a path and import mode."
      | Some specifier ->
          let names = List.filter_map scalar_name name_exprs in
          if List.length names <> List.length name_exprs then
            Error "refer import expects a vector of imported names."
          else
            let resolved_path, module_id =
              resolve_specifier ~source_id ~known_source_ids specifier
            in
            Ok
              {
                specifier;
                resolved_path;
                module_id;
                mode = "refer";
                alias = None;
                names;
              })
  | [] | [ _ ] -> Error "import expects a path and import mode."
  | [ _; Ast.Vector _; _ ] ->
      Error "refer import expects a vector of imported names."
  | _ -> Error "Unsupported import mode."

let parse_export args =
  let names = List.filter_map scalar_name args in
  if args = [] || List.length names <> List.length args then
    Error "export expects one or more names."
  else Ok names

let parse_export_from ~source_id ~known_source_ids args =
  match args with
  | [ specifier_expr; Ast.Vector (_, name_exprs) ] -> (
      match scalar_name specifier_expr with
      | None -> Error "export-from expects a path and a vector of names."
      | Some specifier ->
          let names = List.filter_map scalar_name name_exprs in
          if List.length names <> List.length name_exprs then
            Error "export-from name list must contain only symbols or strings."
          else
            let resolved_path, module_id =
              resolve_specifier ~source_id ~known_source_ids specifier
            in
            Ok { specifier; resolved_path; module_id; names })
  | _ -> Error "export-from expects a path and a vector of names."

let alias_names imports =
  imports
  |> List.filter_map (fun (import : module_import) ->
      match (import.mode, import.alias) with
      | "alias", Some alias -> Some alias
      | _ -> None)

let is_declaration_name_char = function
  | 'A' .. 'Z' | 'a' .. 'z' | '0' .. '9' | '.' | '_' | '-' -> true
  | _ -> false

let is_valid_declaration_name name =
  String.length name > 0
  &&
  match name.[0] with
  | 'A' .. 'Z' | 'a' .. 'z' ->
      String.for_all is_declaration_name_char name
  | _ -> false

let qualified_alias_reference aliases name =
  match String.index_opt name '/' with
  | None -> None
  | Some slash when slash <= 0 || slash >= String.length name - 1 -> None
  | Some slash ->
      let alias = String.sub name 0 slash in
      let local_name =
        String.sub name (slash + 1) (String.length name - slash - 1)
      in
      if List.mem alias aliases && is_valid_declaration_name local_name then
        Some { alias; local_name }
      else None

let rec collect_alias_references aliases = function
  | Ast.Symbol (_, name) -> (
      match qualified_alias_reference aliases name with
      | Some reference -> [ reference ]
      | None -> [])
  | Ast.List (_, exprs) | Ast.Vector (_, exprs) ->
      List.concat_map (collect_alias_references aliases) exprs
  | Ast.Map (_, entries) ->
      entries
      |> List.concat_map (fun (key, value) ->
          collect_alias_references aliases key
          @ collect_alias_references aliases value)
  | Ast.Nil _ | Ast.Bool _ | Ast.Int _ | Ast.Float _ | Ast.String _
  | Ast.Keyword _ ->
      []

let unqualified_reference_name name =
  match String.index_opt name '/' with
  | Some _ -> None
  | None ->
      if is_valid_declaration_name name then Some name else None

let rec collect_unqualified_references = function
  | Ast.Symbol (_, name) -> (
      match unqualified_reference_name name with
      | Some name -> [ name ]
      | None -> [])
  | Ast.List (_, exprs) | Ast.Vector (_, exprs) ->
      List.concat_map collect_unqualified_references exprs
  | Ast.Map (_, entries) ->
      entries
      |> List.concat_map (fun (key, value) ->
          collect_unqualified_references key @ collect_unqualified_references value)
  | Ast.Nil _ | Ast.Bool _ | Ast.Int _ | Ast.Float _ | Ast.String _
  | Ast.Keyword _ ->
      []

let unique_alias_references references =
  references
  |> List.sort_uniq (fun left right ->
      match String.compare left.alias right.alias with
      | 0 -> String.compare left.local_name right.local_name
      | order -> order)

let analyze ?(resolve_exports = fun _ -> None) ~source_id ~known_source_ids
    exprs =
  let used_preludes = ref [] in
  let imports = ref [] in
  let explicit_exports = ref [] in
  let re_exports = ref [] in
  let diagnostics = ref [] in
  let push_diagnostic code message =
    diagnostics := { code; message } :: !diagnostics
  in
  let source_exprs = ref [] in
  let handle_directive head args =
    match head with
    | "use" -> (
        match parse_use args with
        | Ok use -> used_preludes := use :: !used_preludes
        | Error message -> push_diagnostic "module.use.malformed" message)
    | "import" -> (
        match parse_import ~source_id ~known_source_ids args with
        | Ok import -> imports := import :: !imports
        | Error message -> push_diagnostic "module.import.malformed" message)
    | "export" -> (
        match parse_export args with
        | Ok exports -> explicit_exports := exports @ !explicit_exports
        | Error message -> push_diagnostic "module.export.malformed" message)
    | "export-from" -> (
        match parse_export_from ~source_id ~known_source_ids args with
        | Ok re_export -> re_exports := re_export :: !re_exports
        | Error message -> push_diagnostic "module.export-from.malformed" message)
    | _ -> ()
  in
  List.iter
    (function
      | Ast.List (_, Ast.Symbol (_, head) :: args)
        when List.mem head directive_heads ->
          handle_directive head args
      | expr -> source_exprs := expr :: !source_exprs)
    exprs;
  let source_exprs = List.rev !source_exprs in
  let aliases = alias_names !imports in
  let _ = resolve_exports in
  {
    decl =
      {
        module_id = source_id;
        source_path = source_id;
        used_preludes = List.rev !used_preludes;
        imports = List.rev !imports;
        explicit_exports = List.rev !explicit_exports;
        re_exports = List.rev !re_exports;
        diagnostics = List.rev !diagnostics;
        alias_references =
          source_exprs
          |> List.concat_map (collect_alias_references aliases)
          |> unique_alias_references;
        unqualified_references =
          source_exprs
          |> List.concat_map collect_unqualified_references
          |> List.sort_uniq String.compare;
      };
    source_exprs =
      source_exprs;
  }
