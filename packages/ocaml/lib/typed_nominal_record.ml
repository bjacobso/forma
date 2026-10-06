open Type_expr
let scheme t = Type_env.Forall ([],t,[],Type_env.Plain)

let bind env name fields error =
  match Lower_type.parse_type_expr fields with
  | Error ds -> Error (List.map (fun (d:Lower_common.diagnostic) -> Type_diagnostic.make ?span:d.span d.code d.message) ds)
  | Ok fields -> (match Type_resolve.resolve env fields with
      | Error _ as e -> e
      | Ok (TRecord fields as parameter) ->
          let nominal=TNamed name in
          let shape=TRecord (if error then (":_tag",TNamed (Value.string_json name)) :: fields else fields) in
          Ok (Type_env.bind name (scheme (TFn ([parameter],nominal)))
              (Type_env.bind ("__record/" ^ name) (scheme shape)
                (Type_env.bind ("__type/" ^ name) (scheme nominal) env)))
      | Ok _ -> Error [Type_diagnostic.make "typecheck/named-record" "Named record types require record fields."])
