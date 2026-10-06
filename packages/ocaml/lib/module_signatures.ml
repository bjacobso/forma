open Type_expr

let scheme_syntax ?(target = true) e (Type_env.Forall (vars, t, _, _)) =
  let s = Ast.expr_span e in
  let variables = ref [] in
  let variable v =
    if not (List.mem v vars) then "a" ^ string_of_int v
    else
      match List.assoc_opt v !variables with
      | Some n -> n
      | None ->
          let n = "a" ^ string_of_int (List.length !variables) in
          variables := !variables @ [ (v, n) ];
          n
  in
  let sym n = Ast.Symbol (s, n) in
  let call n xs = Ast.List (s, sym n :: xs) in
  let rec convert = function
    | Type_expr.TVar v -> sym (variable v)
    | TInt -> sym "Int"
    | TFloat -> sym "Number"
    | TBool -> sym "Bool"
    | TString -> sym "String"
    | TNil -> sym "Unit"
    | TKeyword -> sym "Keyword"
    | TSymbol -> sym "Symbol"
    | TSyntax -> sym "Syntax"
    | TAny -> sym "Any"
    | TNamed n -> sym n
    | TFn (params, result) ->
        let params = List.map convert params in
        let result = convert result in
        call "->" (params @ [ result ])
    | TRecord fields ->
        Ast.Map
          ( s,
            List.map
              (fun (k, t) -> (Ast.Keyword (s, k), convert t))
              (List.sort (fun (a, _) (b, _) -> String.compare a b) fields) )
    | TList t | TVector t -> call "List" [ convert t ]
    | TNamedApp ("Brand", TNamed name :: _) -> sym name
    | TNamedApp (n, args) ->
        call n
          (List.map
             (function
               | TNamedApp (("ErrorSet" | "RequirementSet"), xs) ->
                   Ast.Vector (s, List.map convert xs)
               | t -> convert t)
             args)
    | TApp (t, args) ->
        let callee = convert t in
        let args = List.map convert args in
        Ast.List (s, callee :: args)
    | TOpenRecord (fields, tail) ->
        if target then
          Module_graph.fail e "module/target-type"
            "Effect TypeScript does not support inferred open-row exports yet; \
             supply a closed signature."
        else
          let fields =
            List.map
              (fun (k, t) -> (Ast.Keyword (s, k), convert t))
              (List.sort (fun (a, _) (b, _) -> String.compare a b) fields)
          in
          let tail = convert tail in
          Ast.Map (s, fields @ [ (sym "&", tail) ])
    | TVariadicFn (params, rest, result) ->
        if target then
          Module_graph.fail e "module/target-type"
            "Effect TypeScript does not support inferred variadic function \
             exports yet."
        else
          let params = List.map convert params in
          let rest = convert rest in
          let result = convert result in
          call "->" (params @ [ sym "&"; rest; result ])
    | TMap -> sym "Map"
    | TMacro -> sym "Macro"
    | TDeclaration -> sym "Declaration"
    | TTypeValue -> sym "TypeValue"
    | TFormDescriptor -> sym "FormDescriptor"
    | TProtocolDescriptor -> sym "ProtocolDescriptor"
  in
  convert t

let syntax_json e =
  let rec convert = function
    | Ast.Symbol (_, n) | Ast.Keyword (_, n) -> Ir_json.String n
    | Ast.Nil _ -> Ir_json.Null
    | Ast.Bool (_, b) -> Ir_json.Bool b
    | Ast.Int (_, n) -> Ir_json.Int n
    | Ast.Float (_, n) -> Ir_json.Float n
    | Ast.String (_, s) -> Ir_json.String s
    | Ast.List (_, xs) | Ast.Vector (_, xs) ->
        Ir_json.Array (List.map convert xs)
    | Ast.Map (_, pairs) ->
        Ir_json.Object
          [
            ( "fields",
              Ir_json.Array
                (List.map
                   (fun (k, v) -> Ir_json.Array [ convert k; convert v ])
                   pairs) );
          ]
  in
  convert e

let add (m : Module_graph.resolved_module) env =
  let signed =
    List.filter_map
      (function
        | Ast.List
            ( _,
              [
                (Ast.Symbol (_, ":") | Ast.Keyword (_, ":"));
                Ast.Symbol (_, n);
                _;
              ] ) ->
            Some n
        | _ -> None)
      m.expressions
  in
  List.concat_map
    (function
      | Ast.List (s, Ast.Symbol (_, "define") :: Ast.Symbol (ns, n) :: _) as e
        when not (List.mem n signed) -> (
          match Type_env.lookup_scheme n env with
          | None -> [ e ]
          | Some scheme ->
              [
                Ast.List
                  ( s,
                    [
                      Ast.Symbol (s, ":");
                      Ast.Symbol (ns, n);
                      scheme_syntax e scheme;
                    ] );
                e;
              ])
      | e -> [ e ])
    m.expressions
