type value = Value.t =
  | VNil
  | VBool of bool
  | VInt of int
  | VFloat of float
  | VString of string
  | VSymbol of string
  | VKeyword of string
  | VList of value list
  | VVector of value list
  | VMap of (value * value) list
  | VDictionary of (value * value) list
  | VClosure of closure
  | VMacro of closure

and closure = Value.closure = {
  params : string list;
  rest_param : string option;
  body : Ast.expr list;
  env : (string * value) list;
}

type diagnostic = Eval_common.diagnostic = {
  span : Ast.span option;
  code : string;
  message : string;
}

type context = {
  eval_expr : Env.t -> Reader.expr -> (value, diagnostic list) result;
  parse_params :
    Reader.expr list -> (string list * string option, diagnostic list) result;
}

let diagnostic = Eval_common.diagnostic

let descriptor_diagnostics (diagnostics : Descriptor.diagnostic list) :
    diagnostic list =
  List.map
    (fun (descriptor_diagnostic : Descriptor.diagnostic) ->
      diagnostic ?span:descriptor_diagnostic.span descriptor_diagnostic.code
        descriptor_diagnostic.message)
    diagnostics

let eval ctx env = function
  | Reader.List
      (_, Reader.Symbol (_, "__form-descriptor") :: Reader.Symbol (_, name) :: clauses)
    -> (
      match Descriptor.validate_form_clauses clauses with
      | Error diagnostics -> Error (descriptor_diagnostics diagnostics)
      | Ok () ->
          let value = Descriptor.declaration_value "form" name clauses in
          Ok (value, Env.bind name value env))
  | Reader.List (_, Reader.Symbol (_, "__form-descriptor") :: _) ->
      Error
        [
          diagnostic "eval/define-form"
            "__form-descriptor expects a symbol name followed by descriptor clauses.";
        ]
  | Reader.List
      (_, Reader.Symbol (_, "__form-hook") :: Reader.Symbol (_, name) :: clauses)
    -> (
      match Descriptor.validate_meta_fn_clauses clauses with
      | Error diagnostics -> Error (descriptor_diagnostics diagnostics)
      | Ok () ->
          let value =
            match Descriptor.meta_fn_body clauses with
            | Some body ->
                VClosure
                  {
                    params = [ "input" ];
                    rest_param = None;
                    body;
                    env = Env.bindings env;
                  }
            | None -> Descriptor.declaration_value "__form-hook" name clauses
          in
          Ok (value, Env.bind name value env))
  | Reader.List (_, Reader.Symbol (_, "__form-hook") :: _) ->
      Error
        [
          diagnostic "eval/meta-fn"
            "__form-hook expects a symbol name followed by descriptor clauses.";
        ]
  | Reader.List
      ( _,
        Reader.Symbol (_, "__projection-plan")
        :: Reader.Symbol (_, name)
        :: clauses ) ->
      let value = Descriptor.declaration_value "elaboration" name clauses in
      Ok (value, Env.bind name value env)
  | Reader.List
      ( _,
        Reader.Symbol (_, "__projection-primitive")
        :: Reader.Symbol (_, name)
        :: clauses ) ->
      let value =
        Descriptor.declaration_value "elaboration-primitive" name clauses
      in
      Ok (value, Env.bind name value env)
  | Reader.List (_, Reader.Symbol (_, "__projection-plan") :: _) ->
      Error
        [
          diagnostic "eval/define-elaboration"
            "__projection-plan expects a symbol name followed by descriptor \
             clauses.";
        ]
  | Reader.List (_, Reader.Symbol (_, "__projection-primitive") :: _) ->
      Error
        [
          diagnostic "eval/define-elaboration-primitive"
            "__projection-primitive expects a symbol name followed by \
             descriptor clauses.";
        ]
  | Reader.List
      ( _,
        Reader.Symbol (_, "__protocol-descriptor")
        :: Reader.Symbol (_, name)
        :: clauses ) ->
      let value = Descriptor.declaration_value "protocol" name clauses in
      Ok (value, Env.bind name value env)
  | Reader.List (_, Reader.Symbol (_, "__protocol-descriptor") :: _) ->
      Error
        [
          diagnostic "eval/define-protocol"
            "__protocol-descriptor expects a symbol name followed by descriptor \
             clauses.";
        ]
  | Reader.List
      ( _,
        Reader.Symbol (_, "__payload-contract")
        :: Reader.Symbol (_, name)
        :: clauses ) ->
      let value =
        Descriptor.declaration_value "payload-contract" name clauses
      in
      Ok (value, Env.bind name value env)
  | Reader.List (_, Reader.Symbol (_, "__payload-contract") :: _) ->
      Error
        [
          diagnostic "eval/define-payload-contract"
            "__payload-contract expects a symbol name followed by payload \
             descriptor clauses.";
        ]
  | Reader.List (_, Reader.Symbol (_, "define-effect") :: _) ->
      Error
        [
          diagnostic "eval/legacy-effect"
            "define-effect is not a public Forma form; use __service and __operation.";
        ]
  | Reader.List
      ( _,
        Reader.Symbol (_, "defmacro")
        :: Reader.Symbol (_, name)
        :: Reader.Vector (_, params)
        :: body ) -> (
      match ctx.parse_params params with
      | Error _ as error -> error
      | Ok (params, rest_param) ->
          let value =
            VMacro { params; rest_param; body; env = Env.bindings env }
          in
          Ok (value, Env.bind name value env))
  | Reader.List (_, Reader.Symbol (_, "defmacro") :: _) ->
      Error
        [
          diagnostic "eval/defmacro-form"
            "defmacro expects a symbol name, parameter vector, and body forms.";
        ]
  | Reader.List
      ( _,
        Reader.Symbol (_, "__macro")
        :: Reader.Symbol (_, name)
        :: Reader.Vector (_, params)
        :: body ) -> (
      match ctx.parse_params params with
      | Error _ as error -> error
      | Ok (params, rest_param) ->
          let value =
            VMacro { params; rest_param; body; env = Env.bindings env }
          in
          Ok (value, Env.bind name value env))
  | Reader.List (_, Reader.Symbol (_, "__macro") :: _) ->
      Error
        [
          diagnostic "eval/define-macro-form"
            "__macro expects a symbol name, parameter vector, and body \
             forms.";
        ]
  | Reader.List
      ( _,
        Reader.Symbol (_, "defn")
        :: Reader.Symbol (_, name)
        :: Reader.Vector (_, params)
        :: body ) -> (
      match ctx.parse_params params with
      | Error _ as error -> error
      | Ok (params, rest_param) ->
          let value =
            VClosure { params; rest_param; body; env = Env.bindings env }
          in
          Ok (value, Env.bind name value env))
  | Reader.List (_, Reader.Symbol (_, "defn") :: _) ->
      Error
        [
          diagnostic "eval/defn-form"
            "defn expects a symbol name, parameter vector, and body forms.";
        ]
  | Reader.List
      ( _,
        Reader.Symbol (_, "define")
        :: Reader.List (_, Reader.Symbol (_, name) :: params)
        :: body ) -> (
      match ctx.parse_params params with
      | Error _ as error -> error
      | Ok (params, rest_param) ->
          let value =
            VClosure { params; rest_param; body; env = Env.bindings env }
          in
          Ok (value, Env.bind name value env))
  | Reader.List
      (_, [ Reader.Symbol (_, "define"); Reader.Symbol (_, name); value_expr ])
    -> (
      match ctx.eval_expr env value_expr with
      | Error _ as error -> error
      | Ok value ->
          let value = match value with
            | VClosure closure ->
                let rec self = VClosure {params=closure.params;rest_param=closure.rest_param;
                  body=closure.body;env=(name,self) :: closure.env} in self
            | value -> value in
          Ok (value, Env.bind name value env))
  | Reader.List (_, Reader.Symbol (_, "define") :: _) ->
      Error
        [
          diagnostic "eval/define-form"
            "define expects a symbol/value pair or function signature and body.";
        ]
  | Reader.List
      (_, [ Reader.Symbol (_, "def"); Reader.Symbol (_, name); value_expr ])
    -> (
      match ctx.eval_expr env value_expr with
      | Error _ as error -> error
      | Ok value ->
          let value = match value with
            | VClosure closure ->
                let rec self = VClosure {params=closure.params;rest_param=closure.rest_param;
                  body=closure.body;env=(name,self) :: closure.env} in self
            | value -> value in
          Ok (value, Env.bind name value env))
  | Reader.List (_, Reader.Symbol (_, "def") :: _) ->
      Error
        [
          diagnostic "eval/def-form"
            "def expects a symbol name and a value expression.";
        ]
  | Reader.List
      ( _,
        [
          (Reader.Symbol (_, ":") | Reader.Keyword (_, ":")); Reader.Symbol _; _;
        ] ) ->
      Ok (VNil, env)
  | Reader.List
      (_, [ (Reader.Symbol (_, ":") | Reader.Keyword (_, ":")); value_expr; _ ])
    -> (
      match ctx.eval_expr env value_expr with
      | Error _ as error -> error
      | Ok value -> Ok (value, env))
  | Reader.List (_, Reader.Symbol (_, op) :: args)
    when Descriptor.is_form_descriptor env op ->
      let args = Surface_form.normalize_application env op args in
      let descriptor_form = Descriptor.form env op in
      let slot_validation =
        match descriptor_form with
        | Some form -> Descriptor.validate_application_slots form args
        | None -> Ok ()
      in
      (match slot_validation with
      | Error diagnostics -> Error (descriptor_diagnostics diagnostics)
      | Ok () ->
          let value = Descriptor.application_value op args in
          let env =
            match descriptor_form with
            | Some form when Env.lookup ("__form/" ^ op) env <> None ->
                let types = match Env.lookup ("__form.types/" ^ op) env with Some (VMap fields) -> fields | _ -> [] in
                let declares n = match Value.lookup_map types (VKeyword (":" ^ n)) with Some (VList (VSymbol "Declares" :: _)) -> true | _ -> false in
                let positional = List.filter (fun e -> match Surface.head e with Some n -> not (String.starts_with ~prefix:":" n) | None -> true) args in
                List.fold_left (fun env (i:Descriptor.identifier_spec) -> if declares i.name then match List.nth_opt positional i.positional_index with Some arg -> (match Surface.name arg with Some n -> Env.bind n value env | None -> env) | None -> env else env) env form.identifiers
            | _ -> (match Descriptor.declaration_binding_name args with Some name -> Env.bind name value env | None -> env)
          in
          Ok (value, env))
  | expr -> (
      match ctx.eval_expr env expr with
      | Error _ as error -> error
      | Ok value -> Ok (value, env))
