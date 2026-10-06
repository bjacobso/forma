(** A domain artifact's reference index contains declaration data, never source
    functions or lexical bindings. It is separate from executable module scopes.
*)
let expressions exprs =
  List.filter
    (fun e ->
      not
        (List.mem
           (Option.value ~default:"" (Surface.head e))
           [ "use"; "import"; "export"; "export-from" ]))
    exprs

let environment (session : Session.t) ?(sources = []) () =
  let sources =
    if sources = [] then
      Hashtbl.fold
        (fun id exprs xs -> (id, exprs) :: xs)
        session.parsed_sources []
    else sources
  in
  let ordered = List.sort (fun (a, _) (b, _) -> String.compare a b) sources in
  let added_bindings before after =
    let boundary = Env.bindings before in
    let rec collect = function
      | bindings when bindings == boundary -> []
      | [] -> []
      | binding :: rest -> binding :: collect rest
    in
    collect (Env.bindings after)
  in
  let rec collect env remaining fuel =
    if fuel = 0 then env
    else
      let next =
        List.fold_left
          (fun env (_, syntax) ->
            let syntax =
              Surface.core_program (Surface_action.program (expressions syntax))
            in
            let metadata =
              List.concat_map
                (fun e ->
                  Option.value ~default:[] (Surface.runtime_constructors e))
                syntax
              |> List.filter (function
                | Ast.List
                    (_, Ast.Symbol (_, "define") :: Ast.Symbol (_, n) :: _) ->
                    List.exists
                      (fun prefix -> String.starts_with ~prefix n)
                      [ "__type/"; "__type-kind/"; "__constructor/" ]
                | _ -> false)
            in
            let env =
              match Eval.evaluate_program_with_env env metadata with
              | Ok (_, local) -> local
              | Error _ -> env
            in
            let declarations =
              List.filter
                (function
                  | Ast.List (_, Ast.Symbol (_, form) :: _) ->
                      Descriptor.is_form_descriptor env form
                  | _ -> false)
                syntax
            in
            List.fold_left
              (fun env declaration ->
                match Eval.evaluate_program_with_env env [ declaration ] with
                | Error _ -> env
                | Ok (_, local) ->
                    added_bindings env local
                    |> List.fold_left
                         (fun env (name, value) ->
                           match Descriptor.declaration_form value with
                           | Some _ -> Env.bind name value env
                           | None -> env)
                         env)
              env declarations)
          env remaining
      in
      let before = Env.visible_bindings env
      and after = Env.visible_bindings next in
      if
        List.length before = List.length after
        && List.for_all
             (fun (n, v) ->
               match List.assoc_opt n before with
               | Some previous -> Value.equal v previous
               | None -> false)
             after
      then next
      else collect next remaining (fuel - 1)
  in
  collect session.core_env ordered (List.length ordered + 1)
