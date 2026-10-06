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
  | VClosure of Value.closure
  | VMacro of Value.closure

type source_config = { forms : string list; sigils : (string * string) list }

type mechanism_config = {
  get_path_mechanism : string;
  pipe_call_mechanism : string;
  unary_mechanism : string;
  binary_mechanism : string;
  compare_nil_mechanism : string;
  conditional_mechanism : string;
  pipe_chain_mechanism : string;
  literal_object_default_key : string;
  json_object_default_key : string;
  var_default_source : string;
}

type shape_config = {
  kind_field : string;
  literal_kind : string;
  literal_value_field : string;
  var_kind : string;
  var_source_field : string;
  var_path_field : string;
  unary_kind : string;
  unary_op_field : string;
  unary_value_field : string;
  binary_kind : string;
  binary_op_field : string;
  binary_left_field : string;
  binary_right_field : string;
  conditional_kind : string;
  conditional_condition_field : string;
  conditional_then_field : string;
  conditional_else_field : string;
  pipe_kind : string;
  pipe_name_field : string;
  pipe_value_field : string;
  pipe_args_field : string;
  compare_nil_operator : string;
}

type op_spec =
  | ExprGetPath
  | ExprPipeCall of string
  | ExprUnary of string
  | ExprBinary of string
  | ExprCompareNil
  | ExprConditional
  | ExprPipeChain

type compile_context = {
  source_config : source_config;
  mechanism_config : mechanism_config;
  shape_config : shape_config;
  op_config : (string * op_spec) list;
}

let op_spec_of_mechanism config mechanism ?name ?op () =
  match mechanism with
  | mechanism when mechanism = config.get_path_mechanism -> Some ExprGetPath
  | mechanism when mechanism = config.pipe_call_mechanism ->
      Option.map (fun name -> ExprPipeCall name) name
  | mechanism when mechanism = config.unary_mechanism ->
      Option.map (fun op -> ExprUnary op) op
  | mechanism when mechanism = config.binary_mechanism ->
      Option.map (fun op -> ExprBinary op) op
  | mechanism when mechanism = config.compare_nil_mechanism ->
      Some ExprCompareNil
  | mechanism when mechanism = config.conditional_mechanism ->
      Some ExprConditional
  | mechanism when mechanism = config.pipe_chain_mechanism -> Some ExprPipeChain
  | _ -> None

let scalar_string = Eval_slot.scalar_string
let keyword key = VKeyword key
let field key value = (keyword (":" ^ key), value)
let object_value entries = VMap entries
let current_source_config : source_config option ref = ref None
let current_op_config : (string * op_spec) list option ref = ref None
let current_mechanism_config : mechanism_config option ref = ref None
let current_shape_config : shape_config option ref = ref None

let default_mechanism_config =
  {
    get_path_mechanism = "get-path";
    pipe_call_mechanism = "pipe-call";
    unary_mechanism = "unary";
    binary_mechanism = "binary";
    compare_nil_mechanism = "compare-nil";
    conditional_mechanism = "conditional";
    pipe_chain_mechanism = "pipe-chain";
    literal_object_default_key = "value";
    json_object_default_key = "value";
    var_default_source = "value";
  }

let default_shape_config =
  {
    kind_field = "kind";
    literal_kind = "literal";
    literal_value_field = "value";
    var_kind = "var";
    var_source_field = "source";
    var_path_field = "path";
    unary_kind = "unary";
    unary_op_field = "op";
    unary_value_field = "value";
    binary_kind = "binary";
    binary_op_field = "op";
    binary_left_field = "left";
    binary_right_field = "right";
    conditional_kind = "conditional";
    conditional_condition_field = "condition";
    conditional_then_field = "then";
    conditional_else_field = "else";
    pipe_kind = "pipe";
    pipe_name_field = "name";
    pipe_value_field = "value";
    pipe_args_field = "args";
    compare_nil_operator = "===";
  }

let with_source_config config fn =
  let previous = !current_source_config in
  current_source_config := Some config;
  Fun.protect ~finally:(fun () -> current_source_config := previous) fn

let with_op_config config fn =
  let previous = !current_op_config in
  current_op_config := Some config;
  Fun.protect ~finally:(fun () -> current_op_config := previous) fn

let with_mechanism_config config fn =
  let previous = !current_mechanism_config in
  current_mechanism_config := Some config;
  Fun.protect ~finally:(fun () -> current_mechanism_config := previous) fn

let with_shape_config config fn =
  let previous = !current_shape_config in
  current_shape_config := Some config;
  Fun.protect ~finally:(fun () -> current_shape_config := previous) fn

let with_context context fn =
  with_source_config context.source_config (fun () ->
      with_mechanism_config context.mechanism_config (fun () ->
          with_shape_config context.shape_config (fun () ->
              with_op_config context.op_config fn)))

let normalize_name name =
  if String.length name > 0 && name.[0] = ':' then
    String.sub name 1 (String.length name - 1)
  else name

let lookup_assoc entries key = List.assoc_opt key entries

let current_source name =
  match !current_source_config with
  | Some config -> (
      match lookup_assoc config.sigils name with
      | Some source -> Some source
      | None -> if List.mem name config.forms then Some name else None)
  | None -> None

let current_op name =
  match !current_op_config with
  | Some config -> lookup_assoc config name
  | None -> None

let current_mechanism () =
  Option.value ~default:default_mechanism_config !current_mechanism_config

let current_shape () =
  Option.value ~default:default_shape_config !current_shape_config

let key_string = function
  | VKeyword name | VSymbol name | VString name -> Some (normalize_name name)
  | value -> scalar_string value |> Option.map normalize_name

let literal_expr value =
  let shape = current_shape () in
  object_value
    [
      field shape.kind_field (VString shape.literal_kind);
      field shape.literal_value_field value;
    ]

let var_expr source path =
  let shape = current_shape () in
  let base =
    [
      field shape.kind_field (VString shape.var_kind);
      field shape.var_source_field (VString source);
    ]
  in
  match path with
  | [] -> object_value base
  | _ ->
      object_value
        (base
        @ [
            field shape.var_path_field
              (VList (List.map (fun segment -> VString segment) path));
          ])

let expr_var_expr name path =
  match current_source name with
  | Some source -> Some (var_expr source path)
  | None -> None

let rec normalize_literal_value = function
  | VNil -> VNil
  | (VBool _ | VInt _ | VFloat _ | VString _) as value -> value
  | VKeyword name | VSymbol name ->
      let name = normalize_name name in
      if name = "nil" || name = "null" then VNil
      else if name = "true" then VBool true
      else if name = "false" then VBool false
      else VString name
  | VList values | VVector values ->
      VList (List.map normalize_literal_value values)
  | (VMap entries | VDictionary entries) ->
      object_value
        (List.map
           (fun (key, value) ->
             let key =
               Option.value
                 ~default:(current_mechanism ()).literal_object_default_key
                 (key_string key)
             in
             field key (normalize_literal_value value))
           entries)
  | (VClosure _ | VMacro _) as value -> value

let path_segment = function
  | VString value -> Some value
  | VInt value -> Some (string_of_int value)
  | VFloat value -> Some (string_of_float value)
  | VBool true -> Some "true"
  | VBool false -> Some "false"
  | VKeyword name | VSymbol name -> Some (normalize_name name)
  | _ -> None

let merge_var_path base segment =
  let shape = current_shape () in
  match base with
  | (VMap entries | VDictionary entries) -> (
      match Value.lookup_map entries (keyword (":" ^ shape.kind_field)) with
      | Some (VString kind) when kind = shape.var_kind ->
          let current =
            match
              Value.lookup_map entries (keyword (":" ^ shape.var_path_field))
            with
            | Some (VList values) | Some (VVector values) ->
                List.filter_map path_segment values
            | _ -> []
          in
          Some
            (var_expr
               (Option.value ~default:(current_mechanism ()).var_default_source
                  (scalar_string
                     (Option.value ~default:VNil
                        (Value.lookup_map entries
                           (keyword (":" ^ shape.var_source_field))))))
               (current @ [ segment ]))
      | _ -> None)
  | _ -> None

let rec compile_first_expr_arg items =
  match items with value :: _ -> compile_expr_node value | _ -> None

and compile_two_expr_args items =
  match items with
  | left :: right :: _ -> (
      match (compile_expr_node left, compile_expr_node right) with
      | Some left, Some right -> Some (left, right)
      | _ -> None)
  | _ -> None

and compile_three_expr_args items =
  match items with
  | first :: second :: third :: _ -> (
      match
        ( compile_expr_node first,
          compile_expr_node second,
          compile_expr_node third )
      with
      | Some first, Some second, Some third -> Some (first, second, third)
      | _ -> None)
  | _ -> None

and compile_named_unary_expr kind field_name field_value value_field items =
  match compile_first_expr_arg items with
  | Some value ->
      Some
        (object_value
           [
             field (current_shape ()).kind_field (VString kind);
             field field_name (VString field_value);
             field value_field value;
           ])
  | None -> None

and compile_binary_nodes op left right =
  let shape = current_shape () in
  object_value
    [
      field shape.kind_field (VString shape.binary_kind);
      field shape.binary_op_field (VString op);
      field shape.binary_left_field left;
      field shape.binary_right_field right;
    ]

and compile_binary_expr op items =
  match compile_two_expr_args items with
  | Some (left, right) -> Some (compile_binary_nodes op left right)
  | None -> None

and compile_get_path_expr items =
  match items with
  | base :: key :: _ -> (
      match (compile_expr_node base, path_segment key) with
      | Some base, Some key -> merge_var_path base key
      | _ -> None)
  | _ -> None

and compile_compare_nil_expr items =
  match compile_first_expr_arg items with
  | Some value ->
      Some
        (compile_binary_nodes (current_shape ()).compare_nil_operator value
           (literal_expr VNil))
  | None -> None

and compile_conditional_expr items =
  match compile_three_expr_args items with
  | Some (condition, then_expr, else_expr) ->
      let shape = current_shape () in
      Some
        (object_value
           [
             field shape.kind_field (VString shape.conditional_kind);
             field shape.conditional_condition_field condition;
             field shape.conditional_then_field then_expr;
             field shape.conditional_else_field else_expr;
           ])
  | None -> None

and compile_pipe_chain_expr items compile_pipe =
  match items with
  | value :: stages -> (
      match compile_expr_node value with
      | None -> None
      | Some value -> compile_pipe value stages)
  | _ -> None

and compile_expr_node expr =
  match expr with
  | VNil -> Some (literal_expr VNil)
  | VString value -> Some (literal_expr (VString value))
  | VInt value -> Some (literal_expr (VInt value))
  | VFloat value -> Some (literal_expr (VFloat value))
  | VBool value -> Some (literal_expr (VBool value))
  | VVector _ -> Some (literal_expr (normalize_literal_value expr))
  | (VMap _ | VDictionary _) -> Some (literal_expr (normalize_literal_value expr))
  | VKeyword name | VSymbol name ->
      let name = normalize_name name in
      if name = "nil" || name = "null" then Some (literal_expr VNil)
      else if name = "true" then Some (literal_expr (VBool true))
      else if name = "false" then Some (literal_expr (VBool false))
      else
        Option.value
          ~default:(literal_expr (VString name))
          (expr_var_expr name [])
        |> Option.some
  | VList [] -> None
  | VList (head :: items) -> (
      let compile_pipe value stages =
        let shape = current_shape () in
        let rec loop current = function
          | [] -> Some current
          | stage :: rest -> (
              match stage with
              | VKeyword name | VSymbol name ->
                  loop
                    (object_value
                       [
                         field shape.kind_field (VString shape.pipe_kind);
                         field shape.pipe_name_field
                           (VString (normalize_name name));
                         field shape.pipe_value_field current;
                       ])
                    rest
              | VList (stage_head :: stage_args) -> (
                  match
                    scalar_string stage_head |> Option.map normalize_name
                  with
                  | None -> None
                  | Some stage_name ->
                      let args = List.filter_map compile_expr_node stage_args in
                      let base =
                        [
                          field shape.kind_field (VString shape.pipe_kind);
                          field shape.pipe_name_field (VString stage_name);
                          field shape.pipe_value_field current;
                        ]
                      in
                      let next =
                        if args = [] then object_value base
                        else
                          object_value
                            (base @ [ field shape.pipe_args_field (VList args) ])
                      in
                      loop next rest)
              | _ -> None)
        in
        loop value stages
      in
      let compile_from_op_spec spec =
        let shape = current_shape () in
        match spec with
        | ExprGetPath -> compile_get_path_expr items
        | ExprPipeCall op_name ->
            compile_named_unary_expr shape.pipe_kind shape.pipe_name_field
              op_name shape.pipe_value_field items
        | ExprUnary op ->
            compile_named_unary_expr shape.unary_kind shape.unary_op_field op
              shape.unary_value_field items
        | ExprBinary op -> compile_binary_expr op items
        | ExprCompareNil -> compile_compare_nil_expr items
        | ExprConditional -> compile_conditional_expr items
        | ExprPipeChain -> compile_pipe_chain_expr items compile_pipe
      in
      let compile_named_form head =
        match expr_var_expr head (List.filter_map path_segment items) with
        | Some _ as expr -> expr
        | None -> Option.bind (current_op head) compile_from_op_spec
      in
      match scalar_string head |> Option.map normalize_name with
      | None -> None
      | Some head -> compile_named_form head)
  | VClosure _ | VMacro _ -> None

let compile_expr expr =
  match compile_expr_node expr with
  | Some value -> value
  | None -> literal_expr (normalize_literal_value expr)

let rec compile_json_value expr =
  match expr with
  | VNil -> VNil
  | (VBool _ | VInt _ | VFloat _ | VString _) as value -> value
  | VKeyword _ | VSymbol _ -> normalize_literal_value expr
  | VVector values | VList values -> VList (List.map compile_json_value values)
  | (VMap entries | VDictionary entries) ->
      object_value
        (List.map
           (fun (key, value) ->
             let key =
               Option.value
                 ~default:(current_mechanism ()).json_object_default_key
                 (key_string key)
             in
             field key (compile_json_value value))
           entries)
  | VClosure _ | VMacro _ -> normalize_literal_value expr
