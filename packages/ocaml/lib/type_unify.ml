open Type_expr

let diagnostic = Type_diagnostic.make

let application_view = function
  | TList item -> Some (TNamed "List", [ item ])
  | TVector item -> Some (TNamed "Vector", [ item ])
  | TNamedApp (name, args) -> Some (TNamed name, args)
  | TApp (callee, args) -> Some (callee, args)
  | _ -> None

let is_finite_type_set = function
  | TNamed ("ErrorSet" | "RequirementSet") -> true
  | _ -> false

let sort_type_set_args args =
  List.sort
    (fun left right -> String.compare (ty_to_string left) (ty_to_string right))
    args

let bind_var id ty =
  match ty with
  | TVar other when other = id -> Ok []
  | _ when List.mem id (free_ty ty) ->
      Error
        [
          diagnostic "typecheck/occurs-check"
            (Printf.sprintf "Type variable %s occurs inside %s."
               (ty_to_diagnostic_string (TVar id))
               (ty_to_diagnostic_string ty));
        ]
  | _ -> Ok [ (id, ty) ]

let rec unify left right =
  match (left, right) with
  | TAny, _ | _, TAny -> Ok []
  | TVar id, ty | ty, TVar id -> bind_var id ty
  | TInt, TInt
  | TFloat, TFloat
  | TBool, TBool
  | TString, TString
  | TNil, TNil
  | TKeyword, TKeyword
  | TSymbol, TSymbol
  | TSyntax, TSyntax
  | TMap, TMap
  | TMacro, TMacro
  | TDeclaration, TDeclaration
  | TTypeValue, TTypeValue
  | TNamed _, TDeclaration
  | TDeclaration, TNamed _
  | TFormDescriptor, TFormDescriptor
  | TProtocolDescriptor, TProtocolDescriptor ->
      Ok []
  | TNamed left, TNamed right when left = right -> Ok []
  | (TRecord _ | TOpenRecord _), TMap | TMap, (TRecord _ | TOpenRecord _) -> Ok []
  | TRecord fields,TOpenRecord (required,tail)
  | TOpenRecord (required,tail),TRecord fields -> unify_open_closed fields required tail
  | TOpenRecord (left,left_tail),TOpenRecord (right,right_tail) ->
      let shared=List.filter (fun (k,_) -> List.mem_assoc k right) left in
      let extra_left=List.filter (fun (k,_) -> not (List.mem_assoc k right)) left in
      let extra_right=List.filter (fun (k,_) -> not (List.mem_assoc k left)) right in
      (match unify_many (List.map snd shared) (List.map (fun (k,_) -> List.assoc k right) shared) with
       | Error _ as e -> e | Ok subst ->
         if extra_left=[] && extra_right=[] then unify (apply_subst subst left_tail) (apply_subst subst right_tail) |> Result.map (fun s -> compose_subst s subst)
         else if apply_subst subst left_tail = apply_subst subst right_tail then
           Error [diagnostic "typecheck/record-shape" "Incompatible fields on records sharing the same row tail."]
         else let common=fresh_tyvar () in
           match unify (apply_subst subst left_tail) (TOpenRecord (List.map (fun (k,t)->k,apply_subst subst t) extra_right,common)) with
           | Error _ as e -> e | Ok s -> let subst=compose_subst s subst in
             unify (apply_subst subst right_tail) (TOpenRecord (List.map (fun (k,t)->k,apply_subst subst t) extra_left,apply_subst subst common)) |> Result.map (fun s -> compose_subst s subst))
  | TRecord left, TRecord right ->
      let left = sort_record_fields left in
      let right = sort_record_fields right in
      let left_labels = List.map fst left in
      let right_labels = List.map fst right in
      if left_labels <> right_labels then
        Error
          [
            diagnostic "typecheck/record-shape"
              (Printf.sprintf "Expected record fields {%s} to match {%s}."
                 (String.concat ", " left_labels)
                 (String.concat ", " right_labels));
          ]
      else unify_many (List.map snd left) (List.map snd right)
  | TList left, TList right | TVector left, TVector right -> unify left right
  | TFn (left_args, left_result), TFn (right_args, right_result) ->
      if List.length left_args <> List.length right_args then
        Error
          [
            diagnostic "typecheck/arity"
              (Printf.sprintf "Function expects %d arguments, received %d."
                 (List.length left_args) (List.length right_args));
          ]
      else
        unify_many (left_args @ [ left_result ]) (right_args @ [ right_result ])
  | ( TVariadicFn (left_params, left_rest, left_result),
      TVariadicFn (right_params, right_rest, right_result) ) ->
      if List.length left_params <> List.length right_params then
        Error
          [
            diagnostic "typecheck/arity"
              (Printf.sprintf
                 "Function expects %d fixed arguments, received %d."
                 (List.length left_params) (List.length right_params));
          ]
      else
        unify_many
          (left_params @ [ left_rest; left_result ])
          (right_params @ [ right_rest; right_result ])
  | TVariadicFn (params, rest, result), TFn (args, fn_result)
  | TFn (args, fn_result), TVariadicFn (params, rest, result) ->
      if List.length args < List.length params then
        Error
          [
            diagnostic "typecheck/arity"
              (Printf.sprintf
                 "Function expects at least %d arguments, received %d."
                 (List.length params) (List.length args));
          ]
      else
        let extra_count = List.length args - List.length params in
        let expected_args = params @ List.init extra_count (fun _ -> rest) in
        unify_many (expected_args @ [ result ]) (args @ [ fn_result ])
  | _ -> (
      match (application_view left, application_view right) with
      | Some (left_callee, left_args), Some (right_callee, right_args) -> (
          match unify left_callee right_callee with
          | Error _ as error -> error
          | Ok callee_subst -> (
              let left_args = List.map (apply_subst callee_subst) left_args in
              let right_args = List.map (apply_subst callee_subst) right_args in
              let left_args, right_args =
                if is_finite_type_set left_callee && is_finite_type_set right_callee
                then (sort_type_set_args left_args, sort_type_set_args right_args)
                else (left_args, right_args)
              in
              match unify_many left_args right_args with
              | Error _ as error -> error
              | Ok arg_subst -> Ok (compose_subst arg_subst callee_subst)))
      | _ ->
          Error
            [
              diagnostic "typecheck/type-mismatch"
                (Printf.sprintf "Expected %s to match %s."
                   (ty_to_diagnostic_string left)
                   (ty_to_diagnostic_string right));
            ])

and unify_open_closed fields required tail =
  if List.exists (fun (k,_) -> not (List.mem_assoc k fields)) required then
    Error [diagnostic "typecheck/record-shape" "Record is missing a required field."]
  else match unify_many (List.map (fun (k,_) -> List.assoc k fields) required) (List.map snd required) with
    | Error _ as e -> e | Ok subst ->
      let remainder = TRecord (List.filter (fun (k,_) -> not (List.mem_assoc k required)) fields) in
      unify (apply_subst subst tail) (apply_subst subst remainder) |> Result.map (fun s -> compose_subst s subst)

and unify_many left right =
  match (left, right) with
  | [], [] -> Ok []
  | left :: left_rest, right :: right_rest -> (
      match unify left right with
      | Error _ as error -> error
      | Ok subst -> (
          let left_rest = List.map (apply_subst subst) left_rest in
          let right_rest = List.map (apply_subst subst) right_rest in
          match unify_many left_rest right_rest with
          | Error _ as error -> error
          | Ok rest_subst -> Ok (compose_subst rest_subst subst)))
  | _ -> Error [ diagnostic "typecheck/arity" "Arity mismatch." ]

let unify_with_span span left right =
  match unify left right with
  | Ok _ as ok -> ok
  | Error diagnostics -> Error (Type_diagnostic.with_span span diagnostics)

let literal_base name =
  if String.starts_with ~prefix:":" name then Some TKeyword
  else if String.starts_with ~prefix:"\"" name then Some TString
  else if name="true" || name="false" then Some TBool
  else match float_of_string_opt name with Some n -> Some (if Float.floor n=n then TInt else TFloat) | None -> None

let rec assign actual expected =
  match actual,expected with
  | TVar _, _ | _, TVar _ -> unify actual expected
  | TNamedApp ((("ErrorSet" | "RequirementSet") as kind),actual),TNamedApp (expected_kind,expected) when kind=expected_kind ->
      let covered = List.for_all (fun actual -> List.exists (fun expected -> actual=expected || match actual,expected with TNamed actual,TNamed expected when kind="RequirementSet" -> String.starts_with ~prefix:(expected ^ ".") actual | _ -> false) expected) actual in
      if covered then Ok [] else Error [diagnostic "typecheck/effect-set" "An effect's errors or requirements exceed its declared set."]
  | TInt,TFloat -> Ok []
  | TNamed literal,expected when literal_base literal=Some expected -> Ok []
  | TNamed literal,TFloat when literal_base literal=Some TInt -> Ok []
  | TNamedApp ("Union",members),expected -> assign_many members (List.map (fun _ -> expected) members)
  | actual,TNamedApp ("Union",members) -> (match List.find_map (fun member -> match assign actual member with Ok s -> Some s | Error _ -> None) members with Some s -> Ok s | None -> unify actual expected)
  | TFn (args,result),TFn (parameters,returns) -> (match assign_many parameters args with Error _ as e -> e | Ok subst -> match assign (apply_subst subst result) (apply_subst subst returns) with Error _ as e -> e | Ok s -> Ok (compose_subst s subst))
  | TRecord fields,TOpenRecord (required,tail) ->
      if List.exists (fun (k,_) -> not (List.mem_assoc k fields)) required then Error [diagnostic "typecheck/record-shape" "Record is missing a required field."]
      else (match assign_many (List.map (fun (k,_) -> List.assoc k fields) required) (List.map snd required) with
        | Error _ as e -> e | Ok subst ->
          let remainder=TRecord (List.filter (fun (k,_) -> not (List.mem_assoc k required)) fields) in
          unify (apply_subst subst tail) (apply_subst subst remainder) |> Result.map (fun s -> compose_subst s subst))
  | TRecord a,TRecord b when List.map fst (sort_record_fields a)=List.map fst (sort_record_fields b) -> assign_many (List.map snd (sort_record_fields a)) (List.map snd (sort_record_fields b))
  | _ ->
      let assigned = match application_view actual, application_view expected with
        | Some (actual_head, actual_args), Some (expected_head, expected_args) ->
            (match unify actual_head expected_head with
             | Error _ as error -> error
             | Ok head_subst ->
                 assign_many (List.map (apply_subst head_subst) actual_args)
                   (List.map (apply_subst head_subst) expected_args)
                 |> Result.map (fun subst -> compose_subst subst head_subst))
        | _ -> unify actual expected in
      assigned |> Result.map_error (List.map (fun (d:Type_diagnostic.t) ->
        if d.code="typecheck/type-mismatch" then {d with message=Printf.sprintf "Expected %s, received %s." (ty_to_diagnostic_string expected) (ty_to_diagnostic_string actual)} else d))
and assign_many actual expected = match actual,expected with
  | [],[] -> Ok []
  | a :: ar,b :: br -> (match assign a b with Error _ as e -> e | Ok s -> match assign_many (List.map (apply_subst s) ar) (List.map (apply_subst s) br) with Error _ as e -> e | Ok rest -> Ok (compose_subst rest s))
  | _ -> Error [diagnostic "typecheck/arity" "Arity mismatch."]

let rec keyword_members = function
  | TKeyword -> Some [TKeyword]
  | TNamed n as t when String.starts_with ~prefix:":" n -> Some [t]
  | TNamedApp ("Union",members) ->
      let resolved=List.map keyword_members members in
      if List.for_all Option.is_some resolved then Some (List.concat_map Option.get resolved) else None
  | _ -> None

let rec join left right =
  match keyword_members left,keyword_members right with
  | Some left,Some right ->
      let members=List.fold_left (fun acc t->if List.mem t acc then acc else acc @ [t]) [] (left @ right) in
      Ok ([],if List.mem TKeyword members then TKeyword else match members with [t]->t | members -> TNamedApp ("Union",members))
  | _ -> match left,right with
      | TInt,TFloat | TFloat,TInt -> Ok ([],TFloat)
      | TList left,TList right -> join left right |> Result.map (fun (s,t)->s,TList t)
      | TRecord left,TRecord right when List.length left=List.length right && List.for_all (fun (key,_)->List.mem_assoc key right) left ->
          let rec fields subst acc = function
            | [] -> Ok (subst,TRecord (List.rev acc))
            | (key,t) :: rest -> (match join (apply_subst subst t) (apply_subst subst (List.assoc key right)) with Error _ as e -> e | Ok (s,t)->fields (compose_subst s subst) ((key,t) :: acc) rest) in
          fields [] [] left
      | TNamedApp (name,left),TNamedApp (other,right) when name=other && List.length left=List.length right ->
          let rec args subst acc left right = match left,right with
            | [],[] -> Ok (subst,TNamedApp (name,List.rev acc))
            | left :: lr,right :: rr -> (match join (apply_subst subst left) (apply_subst subst right) with Error _ as e -> e | Ok (s,t)->args (compose_subst s subst) (t :: acc) lr rr)
            | _ -> assert false in args [] [] left right
      | _ -> unify left right |> Result.map (fun s -> s,apply_subst s left)
