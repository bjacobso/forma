open Module_contract

(** Resolve lexical references and binders after the host graph has resolved
    imports. *)
let expressions ?(allow_resolved = false) ~bindings ~constructors ~imports ~namespaces ~core_bindings
    ~core_type_names ~data_forms ~is_core_binding ~local_core_names authored =
  let resolve_name locals type_context = function
    | Ast.Symbol (span, n) as e -> (
        let root = List.hd (String.split_on_char '.' n) in
        if
          (allow_resolved && contains n "__forma_") || List.mem n locals || List.mem root locals
          || String.starts_with ~prefix:":" n
          || (not (List.mem_assoc root (bindings @ imports)))
             && (not
                   (List.mem_assoc
                      (List.hd (String.split_on_char '/' n))
                      namespaces))
             && (List.mem n local_core_names
                || List.mem n core_bindings
                || List.mem n Eval_meta.builtin_names
                || is_core_binding n)
        then e
        else
          let binding, suffix =
            match String.index_opt n '/' with
            | Some slash when slash > 0 ->
                let alias = String.sub n 0 slash
                and qualified =
                  String.sub n (slash + 1) (String.length n - slash - 1)
                in
                let member_root =
                  List.hd (String.split_on_char '.' qualified)
                in
                let m =
                  match List.assoc_opt alias namespaces with
                  | Some m -> m
                  | None ->
                      fail e "module/namespace"
                        ("Unknown module namespace " ^ alias ^ ".")
                in
                let b =
                  match
                    List.find_opt
                      (fun b -> b.name = member_root)
                      m.interface.exports
                  with
                  | Some b -> b
                  | None ->
                      fail e "module/private-export"
                        (m.id ^ " does not export " ^ member_root ^ ".")
                in
                if later b then
                  fail e "module/compile-time-stage"
                    ("Importing " ^ b.kind ^ " " ^ member_root
                   ^ " requires RFC 0002 stage 2.");
                ( Some b,
                  String.sub qualified
                    (String.length member_root)
                    (String.length qualified - String.length member_root) )
            | _ -> (
                match List.assoc_opt n (bindings @ imports) with
                | Some b -> (Some b, "")
                | None ->
                    ( List.assoc_opt root (bindings @ imports),
                      String.sub n (String.length root)
                        (String.length n - String.length root) ))
          in
          match binding with
          | Some b ->
              if
                suffix <> ""
                && List.mem b.kind [ "macro"; "form"; "typeclass"; "layer" ]
              then
                fail e "module/namespace"
                  (b.name ^ " has no constructor or service members.");
              if
                suffix <> "" && b.kind = "type"
                && not
                     (List.mem
                        (String.sub suffix 1 (String.length suffix - 1))
                        b.constructors)
              then
                fail e "module/constructor"
                  (b.name ^ " has no constructor "
                  ^ String.sub suffix 1 (String.length suffix - 1)
                  ^ ".");
              Ast.Symbol (span, b.symbol ^ suffix)
          | None -> (
              if List.mem_assoc n namespaces then
                fail e "module/namespace"
                  ("Namespace " ^ n ^ " is a compile-time alias; use " ^ n
                 ^ "/export-name.");
              match List.assoc_opt n constructors with
              | Some [ b ] -> Ast.Symbol (span, b.symbol ^ "." ^ n)
              | Some (_ :: _ :: _) ->
                  fail e "surface/ambiguous-constructor"
                    ("Ambiguous constructor " ^ n ^ "; use Type." ^ n ^ ".")
              | _ ->
                  if not type_context && List.mem n ["when";"unless";"cond";"and";"or";"->";"->>"] then fail e "module/unimported-sugar" ("Import "^n^" from a library or select a project prelude.");
                  if contains n "__forma_" then
                    fail e "module/private-name"
                      ("Resolved declaration identities cannot be written in \
                        source: " ^ n ^ ".");
                  if
                    type_context && Surface.is_upper root
                    && not (List.mem root (core_types @ core_type_names))
                  then
                    fail e "module/private-name"
                      ("Unknown or private type " ^ n
                     ^ "; import it explicitly.");
                  e))
    | e -> e
  in
  let resolving_template = ref false in
  let rec pattern locals = function
    | Ast.Symbol (_, n) as e ->
        if Surface.is_upper n || contains n "/" || contains n "." then
          resolve_name locals false e
        else e
    | Ast.List (s, xs) -> Ast.List (s, List.map (pattern locals) xs)
    | Ast.Vector (s, xs) -> Ast.Vector (s, List.map (pattern locals) xs)
    | Ast.Map (s, xs) ->
        Ast.Map (s, List.map (fun (k, v) -> (k, pattern locals v)) xs)
    | e -> e
  and walk locals type_context = function
    | Ast.List (_, Ast.Symbol (_, h) :: _) as e
      when List.mem h
             [
               "__form-descriptor";
               "__protocol-descriptor";
               "__payload-contract";
               "__projection-plan";
               "__projection-primitive";
             ]
           || List.mem h data_forms ->
        e
    | Ast.Symbol _ as e -> resolve_name locals type_context e
    | Ast.Map (s, pairs) ->
        Ast.Map
          (s, List.map (fun (k, v) -> (k, walk locals type_context v)) pairs)
    | Ast.Vector (s, xs) ->
        Ast.Vector (s, List.map (walk locals type_context) xs)
    | Ast.List (_, Ast.Symbol _ :: _) as e when directive e ->
        fail e "module/top-level"
          "Module directives must appear at file top level."
    | Ast.List (_, Ast.Symbol (_, "quote") :: _) as e -> e
    | Ast.List (s, (Ast.Symbol (_, "quasiquote") as h) :: xs) ->
        let rec quoted = function
          | Ast.List (_, Ast.Symbol (_, ("unquote" | "unquote-splicing")) :: _)
            as e ->
              walk locals false e
          | Ast.List (s, xs) -> Ast.List (s, List.map quoted xs)
          | Ast.Vector (s, xs) -> Ast.Vector (s, List.map quoted xs)
          | Ast.Map (s, pairs) ->
              Ast.Map (s, List.map (fun (k, v) -> (quoted k, quoted v)) pairs)
          | Ast.Symbol _ as e when !resolving_template ->
              resolve_name locals false e
          | e -> e
        in
        Ast.List (s, h :: List.map quoted xs)
    | Ast.List
        (s, (Ast.Symbol (_, "fn") as h) :: (Ast.Vector (_, _) as params) :: body)
      ->
        Ast.List
          ( s,
            h :: params
            :: List.map (walk (locals @ bound_names params) false) body )
    | Ast.List
        ( s,
          (Ast.Symbol (_, "define") as h)
          :: n
          :: (Ast.Vector (_, _) as params)
          :: body ) when body <> [] ->
        Ast.List
          ( s,
            h
            :: resolve_name locals false n
            :: params
            :: List.map (walk (locals @ bound_names params) false) body )
    | Ast.List
        ( s,
          (Ast.Symbol (_, ("let" | "do!")) as h)
          :: Ast.Vector (bs, pairs)
          :: body ) ->
        let rec loop locals acc = function
          | (Ast.Keyword (_, ":let") as k) :: Ast.Vector (vs, bindings) :: xs ->
              let locals, bindings = loop locals [] bindings in
              loop locals (acc @ [ k; Ast.Vector (vs, bindings) ]) xs
          | p :: v :: xs ->
              loop
                (locals @ bound_names p)
                (acc @ [ pattern locals p; walk locals false v ])
                xs
          | _ -> (locals, acc)
        in
        let locals, pairs = loop locals [] pairs in
        Ast.List
          (s, h :: Ast.Vector (bs, pairs) :: List.map (walk locals false) body)
    | Ast.List (s, (Ast.Symbol (_, ("match" | "catch")) as h) :: value :: arms)
      ->
        let rec loop = function
          | p :: rhs :: xs ->
              pattern locals p
              :: walk (locals @ bound_names p) false rhs
              :: loop xs
          | xs -> xs
        in
        Ast.List (s, h :: walk locals false value :: loop arms)
    | Ast.List
        ( s,
          (Ast.Symbol (_, ("type" | "class" | "error")) as h) :: header :: args
        ) ->
        let header, local =
          match header with
          | Ast.List (s, n :: ps) ->
              ( Ast.List (s, resolve_name locals false n :: ps),
                locals @ List.concat_map bound_names ps )
          | n -> (resolve_name locals false n, locals)
        in
        let body = function
          | Ast.List (s, (Ast.Symbol (_, "Tagged") as h) :: arms) ->
              let rec loop = function
                | (Ast.Keyword (_, ":tag") as k) :: tag :: xs ->
                    k :: tag :: loop xs
                | Ast.List (s, n :: ts) :: xs ->
                    Ast.List (s, n :: List.map (walk local true) ts) :: loop xs
                | n :: xs -> n :: loop xs
                | [] -> []
              in
              Ast.List (s, h :: loop arms)
          | e -> walk local true e
        in
        Ast.List
          ( s,
            h :: header
            :: (match args with t :: rest -> body t :: rest | [] -> []) )
    | Ast.List (s, [ ((Ast.Symbol (_, ":") | Ast.Keyword (_, ":")) as h); n; t ])
      ->
        Ast.List (s, [ h; resolve_name locals false n; walk locals true t ])
    | Ast.List (s, (Ast.Symbol (_, "layer") as h) :: n :: args) ->
        let local =
          locals
          @ List.filter_map
              (function
                | Ast.List
                    (_, Ast.Symbol (_, "define") :: Ast.Symbol (_, n) :: _) ->
                    Some n
                | _ -> None)
              args
        in
        let rec loop local = function
          | (Ast.Keyword (_, ":setup") as key) :: Ast.Vector (vs, pairs) :: rest
            ->
              let rec bindings local = function
                | p :: v :: xs ->
                    let v = walk local false v in
                    let local, rest = bindings (local @ bound_names p) xs in
                    (local, p :: v :: rest)
                | xs -> (local, xs)
              in
              let local, pairs = bindings local pairs in
              key :: Ast.Vector (vs, pairs) :: loop local rest
          | e :: rest -> walk local false e :: loop local rest
          | [] -> []
        in
        Ast.List (s, h :: resolve_name locals false n :: loop local args)
    | Ast.List (s, (Ast.Symbol (_, "service") as h) :: n :: methods) ->
        let method_ = function
          | Ast.List
              (s, [ ((Ast.Symbol (_, ":") | Ast.Keyword (_, ":")) as h); n; t ])
            ->
              Ast.List (s, [ h; n; walk locals true t ])
          | e -> walk locals false e
        in
        Ast.List
          (s, h :: resolve_name locals false n :: List.map method_ methods)
    | Ast.List
        ( s,
          (Ast.Symbol (_, ("macro" | "form")) as h)
          :: Ast.List (ps, n :: params)
          :: body ) ->
        let previous = !resolving_template in
        resolving_template := true;
        let body =
          List.map
            (walk (locals @ List.concat_map bound_names params) false)
            body
        in
        resolving_template := previous;
        Ast.List
          (s, h :: Ast.List (ps, resolve_name locals false n :: params) :: body)
    | Ast.List (s, xs) -> Ast.List (s, List.map (walk locals type_context) xs)
    | e -> e
  in
  let expressions =
    List.filter (fun e -> not (directive e)) authored
    |> List.concat_map (fun e ->
        let resolved = walk [] false e in
        match e with
        | Ast.List (span, Ast.Symbol (_, h) :: Ast.Symbol (_, n) :: _)
          when List.mem h data_forms -> (
            match List.assoc_opt n bindings with
            | Some b ->
                [
                  resolved;
                  Ast.List
                    ( span,
                      [
                        Ast.Symbol (span, "define");
                        Ast.Symbol (span, b.symbol);
                        Ast.Symbol (span, n);
                      ] );
                ]
            | None -> [ resolved ])
        | _ -> [ resolved ])
  in
  expressions
