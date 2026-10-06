include Module_contract

let resolve ?(core_bindings = []) ?(core_type_names = []) ?(data_forms = [])
    ?(is_core_binding = fun _ -> false) (entry : source) (resolver : resolver) =
  let completed = Hashtbl.create 16 and ordered = ref [] and active = ref [] in
  let rec visit (input : source) =
    let id = normalize_id input.id in
    match Hashtbl.find_opt completed id with
    | Some m -> m
    | None ->
        active := !active @ [ id ];
        let authored =
          match Reader.parse_ast ~source_id:id input.source with
          | Ok xs -> xs
          | Error ds -> (
              match ds with
              | d :: _ ->
                  raise
                    (Error
                       (Type_diagnostic.make ?span:d.Reader.span d.code
                          d.message))
              | [] -> assert false)
        in
        let bindings = ref [] and constructors = ref [] in
        List.iter
          (function
            | Ast.List (_, Ast.Symbol (_, h) :: header :: args) -> (
                match kind h with
                | None -> ()
                | Some kind -> (
                    let n =
                      match name header with
                      | Some n -> Some n
                      | None -> (
                          match header with
                          | Ast.List (_, n :: _) -> name n
                          | _ -> None)
                    in
                    match n with
                    | None -> ()
                    | Some n ->
                        if
                          contains n "/" || contains n "."
                          || contains n "__forma_"
                        then
                          fail header "module/declaration-name"
                            ("Module declaration " ^ n
                           ^ " must be an unqualified name without the \
                              reserved __forma_ marker.");
                        if List.mem_assoc n !bindings then
                          fail header "module/duplicate-declaration"
                            ("Duplicate declaration " ^ n ^ " in " ^ id ^ ".");
                        let arms =
                          match (kind, args) with
                          | ( "type",
                              Ast.List (_, Ast.Symbol (_, "Tagged") :: arms)
                              :: _ ) -> (
                              match arms with
                              | Ast.Keyword (_, ":tag") :: _ :: xs -> xs
                              | _ -> arms)
                          | _ -> []
                        in
                        let names =
                          List.filter_map
                            (fun a ->
                              match name a with
                              | Some n -> Some n
                              | None -> head a)
                            arms
                        in
                        let identity = { module_id = id; declaration = n } in
                        let b =
                          {
                            name = n;
                            identity;
                            symbol = symbol identity;
                            kind;
                            constructors = names;
                            scheme = None;
                          }
                        in
                        bindings := !bindings @ [ (n, b) ];
                        List.iter
                          (fun n ->
                            let bs =
                              Option.value ~default:[]
                                (List.assoc_opt n !constructors)
                            in
                            constructors :=
                              (n, bs @ [ b ])
                              :: List.remove_assoc n !constructors)
                          names))
            | _ -> ())
          authored;
        let local_data_forms =
          List.filter_map
            (function
              | Ast.List
                  ( _,
                    Ast.Symbol (_, "__form-descriptor")
                    :: Ast.Symbol (_, name)
                    :: _ ) ->
                  Some name
              | _ -> None)
            authored
        in
        let data_forms = data_forms @ local_data_forms in
        let rec registry_operations = function
          | Ast.Map (_, fields) ->
              List.concat_map
                (function
                  | Ast.Keyword (_, ":compile-layout-tree-op"), Ast.String (_, n)
                    ->
                      [ n ]
                  | _, v -> registry_operations v)
                fields
          | Ast.List
              ( _,
                Ast.Keyword (_, ":compile-layout-tree-op")
                :: Ast.Symbol (_, n)
                :: _ ) ->
              [ n ]
          | Ast.List (_, xs) | Ast.Vector (_, xs) ->
              List.concat_map registry_operations xs
          | _ -> []
        in
        let local_core_names =
          List.concat_map
            (function
              | Ast.List
                  ( _,
                    Ast.Symbol (_, ("define" | "__protocol-descriptor"))
                    :: _ :: body ) ->
                  List.concat_map registry_operations body
              | _ -> [])
            authored
        in
        let imports = ref []
        and namespaces = ref []
        and exports = ref []
        and dependencies = ref [] in
        let dependency e args =
          let specifier, at =
            match args with
            | (Ast.String (_, s) as at) :: _ -> (s, at)
            | _ ->
                fail e "module/directive"
                  "An import or export-from requires a string file specifier."
          in
          if
            not
              (String.starts_with ~prefix:"./" specifier
              || String.starts_with ~prefix:"../" specifier)
          then
            fail at "module/package-stage"
              ("Package import " ^ specifier
             ^ " requires RFC 0002 stage 3; use a relative file import.");
          let resolved : source =
            match resolver ~specifier ~importer:id with
            | Some s -> s
            | None ->
                fail at "module/not-found"
                  ("Cannot resolve " ^ specifier ^ " from " ^ id ^ ".")
          in
          let target = normalize_id resolved.id in
          if List.mem target !active then
            fail at "module/cycle"
              ("Module cycle: "
              ^ String.concat " -> " (!active @ [ target ])
              ^ ". Remove an import to break the cycle.");
          let m = visit { resolved with id = target } in
          if not (List.mem target !dependencies) then
            dependencies := !dependencies @ [ target ];
          m
        in
        let public_binding m n =
          let nstr =
            match name n with
            | Some s -> s
            | None ->
                fail n "module/directive"
                  "Imported and exported names must be symbols."
          in
          let b =
            match
              List.find_opt (fun b -> b.name = nstr) m.interface.exports
            with
            | Some b -> b
            | None ->
                fail n "module/private-export"
                  (m.id ^ " does not export " ^ nstr ^ "; declare (export "
                 ^ nstr ^ ") in its owning file.")
          in
          if later b then
            fail n "module/compile-time-stage"
              ("Importing " ^ b.kind ^ " " ^ nstr
             ^ " requires RFC 0002 stage 2 (compile-time libraries).");
          b
        in
        let add_export at b =
          if List.mem_assoc b.name !exports then
            fail at "module/duplicate-export"
              ("Duplicate export " ^ b.name ^ " in " ^ id ^ ".");
          if later b then
            fail at "module/compile-time-stage"
              ("Exporting " ^ b.kind ^ " " ^ b.name
             ^ " requires RFC 0002 stage 2 (compile-time libraries).");
          exports := !exports @ [ (b.name, b) ]
        in
        List.iter
          (function
            | Ast.List
                (_, Ast.Symbol (_, (("import" | "export-from") as h)) :: args)
              as e -> (
                let m = dependency e args in
                match (h, args) with
                | ( "import",
                    [ _; Ast.Keyword (_, ":as"); (Ast.Symbol (_, alias) as at) ]
                  ) ->
                    if
                      List.mem_assoc alias !bindings
                      || List.mem_assoc alias !imports
                      || List.mem_assoc alias !namespaces
                      || contains alias "/" || contains alias "."
                    then
                      fail at "module/duplicate-import"
                        ("Namespace " ^ alias
                       ^ " conflicts with a local binding or import.");
                    namespaces := !namespaces @ [ (alias, m) ]
                | _, [ _; Ast.Vector (_, names) ] ->
                    List.iter
                      (fun n ->
                        let b = public_binding m n in
                        if h = "export-from" then add_export n b
                        else (
                          if
                            List.mem_assoc b.name !bindings
                            || List.mem_assoc b.name !imports
                            || List.mem_assoc b.name !namespaces
                          then
                            fail n "module/duplicate-import"
                              ("Import " ^ b.name
                             ^ " conflicts with a local binding or import.");
                          imports := !imports @ [ (b.name, b) ]))
                      names
                | _ ->
                    fail e "module/directive"
                      ("Use (" ^ h ^ " \"./file.forma\" [names])"
                      ^
                      if h = "import" then
                        " or (import \"./file.forma\" :as alias)."
                      else "."))
            | _ -> ())
          authored;
        List.iter
          (function
            | Ast.List (_, Ast.Symbol (_, "export") :: names) as e ->
                if names = [] then
                  fail e "module/directive" "export requires one or more names.";
                List.iter
                  (fun at ->
                    let n = Option.value ~default:"expression" (name at) in
                    match List.assoc_opt n (!bindings @ !imports) with
                    | Some b -> add_export at b
                    | None ->
                        fail at "module/missing-export"
                          ("Cannot export " ^ n
                         ^ ": no local declaration or named import."))
                  names
            | _ -> ())
          authored;
        let expressions =
          Module_scope.expressions ~bindings:!bindings
            ~constructors:!constructors ~imports:!imports
            ~namespaces:!namespaces ~core_bindings ~core_type_names ~data_forms
            ~is_core_binding ~local_core_names authored
        in
        let interface =
          {
            module_id = id;
            exports =
              List.map snd !exports
              |> List.sort (fun a b -> String.compare a.name b.name);
          }
        in
        let m =
          {
            id;
            source = input.source;
            expressions;
            dependencies = !dependencies;
            bindings = !bindings;
            imports = !imports;
            namespace_imports =
              List.concat_map
                (fun (_, m) ->
                  List.filter (fun b -> not (later b)) m.interface.exports)
                !namespaces;
            interface;
          }
        in
        Hashtbl.add completed id m;
        ordered := !ordered @ [ m ];
        active := List.rev (List.tl (List.rev !active));
        m
  in
  try
    let root = visit entry in
    Ok { entry = root.id; modules = !ordered }
  with Error d -> Error [ d ]
