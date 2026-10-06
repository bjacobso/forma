(* Bindings owned by a source; references never become declarations. *)
let updates (env : Eval.env) = function
  | Ast.List
      ( _,
        Ast.Symbol
          ( _,
            ( "define" | "macro" | "form" | "type" | "class" | "error" | "typeclass" | "def" | "defn" | "defmacro" | "__macro"
            | "__form-descriptor" | "__form-hook" | "__projection-plan"
            | "__projection-primitive" | "__protocol-descriptor"
            | "__payload-contract" ) )
        :: _ ) ->
      true
  | Ast.List (_, Ast.Symbol (_, op) :: args) ->
      Descriptor.is_form_descriptor env op
      && Option.is_some (Descriptor.declaration_binding_name args)
  | _ -> false

let binding_name (env : Eval.env) = function
  | Ast.List
      ( _,
        Ast.Symbol
          ( _,
            ( "__form-descriptor" | "__form-hook" | "__projection-plan"
            | "__projection-primitive" | "__protocol-descriptor"
            | "__payload-contract" | "defmacro" | "__macro"
            | "defn" ) )
        :: Ast.Symbol (_, name)
        :: _ ) ->
      Some name
  | Ast.List (_, Ast.Symbol (_, ("define" | "def")) :: Ast.Symbol (_, name) :: _)
    ->
      Some name
  | Ast.List
      ( _,
        Ast.Symbol (_, "define") :: Ast.List (_, Ast.Symbol (_, name) :: _) :: _
      ) ->
      Some name
  | Ast.List (application_span, Ast.Symbol (_, op) :: args)
    when Descriptor.is_form_descriptor env op ->
      if Env.lookup ("__form/" ^ op) env <> None then
        Option.bind (Descriptor.form env op) (fun form ->
          Option.bind (List.find_opt (fun (id:Descriptor.identifier_spec) ->
            match Env.lookup ("__form.types/" ^ op) env with
            | Some (Value.VMap fields) -> (match List.assoc_opt (Value.VKeyword (":" ^ id.name)) fields with
                | Some (Value.VList (Value.VSymbol "Declares" :: _)) -> true | _ -> false)
            | _ -> false) form.identifiers)
            (fun id ->
              let declaration=Descriptor.application_value op (Surface_form.normalize_application ~span:application_span env op args) in
              match Eval_slot.identifier_value_with_lookup ~lookup:(fun n->Env.lookup n env) declaration (Value.VString id.name) with
              | Value.VSymbol n -> Some n | _ -> None))
      else Descriptor.declaration_binding_name args
  | _ -> None

let names env exprs =
  Surface.core_program (Surface_protocol.program (Surface_form.program exprs))
  |> List.concat_map (fun expr ->
      let definitions=Option.value ~default:[] (Surface.runtime_constructors expr) in
      let bindings=List.filter_map (binding_name env) (expr :: definitions) in
      let declared=match expr with
        | Ast.List (_,Ast.Symbol (_,("__sum-type" | "__type-alias")) :: Ast.Symbol (_,n) :: _)
        | Ast.List (_,Ast.Symbol (_,("__sum-type" | "__type-alias")) :: Ast.List (_,Ast.Symbol (_,n) :: _) :: _) -> [n]
        | _ -> [] in declared @ bindings)
  |> List.sort_uniq String.compare
