type source = { id : string; source : string }
(** Host-resolved, isolated file modules. This library performs no filesystem
    IO. *)

type resolver = specifier:string -> importer:string -> source option
type identity = { module_id : string; declaration : string }
type type_scheme = { parameters : string list; syntax : Ir_json.t }

type binding = {
  name : string;
  identity : identity;
  symbol : string;
  kind : string;
  constructors : string list;
  scheme : type_scheme option;
}

type interface = { module_id : string; exports : binding list }

type resolved_module = {
  id : string;
  source : string;
  expressions : Ast.expr list;
  dependencies : string list;
  bindings : (string * binding) list;
  imports : (string * binding) list;
  namespace_imports : binding list;
  interface : interface;
}

type t = { entry : string; modules : resolved_module list }

exception Error of Type_diagnostic.t

let fail e code message =
  raise (Error (Type_diagnostic.make ~span:(Ast.expr_span e) code message))

let normalize_id path =
  let absolute = String.starts_with ~prefix:"/" path in
  let rec loop acc = function
    | [] -> List.rev acc
    | "" :: xs | "." :: xs -> loop acc xs
    | ".." :: xs -> (
        match acc with
        | a :: rest when a <> ".." -> loop rest xs
        | _ -> loop (if absolute then acc else ".." :: acc) xs)
    | x :: xs -> loop (x :: acc) xs
  in
  (if absolute then "/" else "")
  ^ String.concat "/"
      (loop []
         (String.split_on_char '/'
            (String.map (function '\\' -> '/' | c -> c) path)))

let relative_id specifier importer =
  let base =
    match String.rindex_opt importer '/' with
    | None -> ""
    | Some i -> String.sub importer 0 (i + 1)
  in
  normalize_id (base ^ specifier)

let source_resolver sources ~specifier ~importer =
  if
    not
      (String.starts_with ~prefix:"./" specifier
      || String.starts_with ~prefix:"../" specifier)
  then None
  else
    let id = relative_id specifier importer in
    List.find_opt (fun (s : source) -> normalize_id s.id = id) sources
    |> Option.map (fun (s : source) -> { s with id })

let symbol identity =
  let hex value =
    String.to_seq value
    |> Seq.map (fun c -> Printf.sprintf "%02x" (Char.code c))
    |> List.of_seq |> String.concat ""
  in
  identity.declaration ^ "__forma_" ^ hex identity.module_id ^ "_d"
  ^ hex identity.declaration

let name = function Ast.Symbol (_, n) -> Some n | _ -> None
let head = function Ast.List (_, Ast.Symbol (_, h) :: _) -> Some h | _ -> None

let directive e =
  List.mem
    (Option.value ~default:"" (head e))
    [ "import"; "export"; "export-from" ]

let kind = function
  | "define" -> Some "value"
  | ( "type" | "class" | "error" | "service" | "layer" | "macro" | "form"
    | "typeclass" ) as h ->
      Some h
  | "entity" | "query" | "command" | "view" | "rule" | "protocol" ->
      Some "value"
  | _ -> None

let later b = List.mem b.kind [ "macro"; "form"; "typeclass"; "compile-time" ]

let contains hay needle =
  let lh = String.length hay and ln = String.length needle in
  let rec loop i =
    i + ln <= lh && (String.sub hay i ln = needle || loop (i + 1))
  in
  loop 0

let core_types =
  [
    "String";
    "Int";
    "Number";
    "Bool";
    "Unit";
    "Json";
    "Any";
    "Unknown";
    "Never";
    "Symbol";
    "Keyword";
    "Type";
    "Syntax";
    "RuntimeExpr";
    "Bytes";
    "DateTime";
    "Duration";
    "List";
    "Option";
    "Map";
    "Record";
    "Union";
    "Tagged";
    "Id";
    "Brand";
    "Result";
    "->";
    "Effect";
    "Stream";
    "Layer";
    "Fiber";
    "Ref";
    "RefCell";
    "Scope";
    "OntologyRuntime";
    "Action";
    "Declares";
    "FormDescriptor";
  ]

let rec bound_names = function
  | Ast.Symbol (_, n)
    when Surface.is_lower n && not (List.mem n [ "nil"; "true"; "false"; "&" ])
    ->
      [ n ]
  | Ast.Map (_, pairs) ->
      List.concat_map
        (function
          | Ast.Keyword (_, ":keys"), Ast.Vector (_, xs) ->
              List.filter_map name xs
          | _, v -> bound_names v)
        pairs
  | Ast.List (_, xs) | Ast.Vector (_, xs) -> List.concat_map bound_names xs
  | _ -> []

let interface_json (i : interface) =
  let str = fun s -> Ir_json.String s in
  Ir_json.Object
    [
      ("moduleId", str i.module_id);
      ( "exports",
        Ir_json.Array
          (List.map
             (fun b ->
               Ir_json.Object
                 ([
                    ("name", str b.name);
                    ( "identity",
                      Ir_json.Object
                        [
                          ("moduleId", str b.identity.module_id);
                          ("declaration", str b.identity.declaration);
                        ] );
                    ("symbol", str b.symbol);
                    ("kind", str b.kind);
                    ("constructors", Ir_json.Array (List.map str b.constructors));
                  ]
                 @
                 match b.scheme with
                 | None -> []
                 | Some scheme ->
                     [
                       ( "scheme",
                         Ir_json.Object
                           [
                             ( "parameters",
                               Ir_json.Array (List.map str scheme.parameters) );
                             ("type", scheme.syntax);
                           ] );
                     ]))
             i.exports) );
    ]
