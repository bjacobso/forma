type ty =
  | TVar of int
  | TInt
  | TFloat
  | TBool
  | TString
  | TNil
  | TKeyword
  | TSymbol
  | TSyntax
  | TAny
  | TList of ty
  | TVector of ty
  | TMap
  | TRecord of (string * ty) list
  | TOpenRecord of (string * ty) list * ty
  | TFn of ty list * ty
  | TVariadicFn of ty list * ty * ty
  | TMacro
  | TDeclaration
  | TTypeValue
  | TNamed of string
  | TNamedApp of string * ty list
  | TApp of ty * ty list
  | TFormDescriptor
  | TProtocolDescriptor

type subst = (int * ty) list

let next_tyvar = ref 0

let fresh_tyvar () =
  let id = !next_tyvar in
  incr next_tyvar;
  TVar id

let record_label label =
  if String.starts_with ~prefix:":" label then label
  else Value.string_json (if String.starts_with ~prefix:"\000str:" label then String.sub label 5 (String.length label-5) else label)

let rec ty_to_string = function
  | TVar id -> Printf.sprintf "'%d" id
  | TInt -> "Int"
  | TFloat -> "Number"
  | TBool -> "Bool"
  | TString -> "String"
  | TNil -> "Unit"
  | TKeyword -> "Keyword"
  | TSymbol -> "Symbol"
  | TSyntax -> "Syntax"
  | TAny -> "Any"
  | TList item -> "List<" ^ ty_to_string item ^ ">"
  | TVector item -> "List<" ^ ty_to_string item ^ ">"
  | TMap -> "Map"
  | TOpenRecord (fields,tail) -> "{" ^ String.concat " " (List.map (fun (k,t)->record_label k ^ " " ^ ty_to_string t) fields) ^ " & " ^ ty_to_string tail ^ "}"
  | TRecord fields -> "{" ^ String.concat " " (List.map (fun (k,t)->record_label k ^ " " ^ ty_to_string t) fields) ^ "}"
  | TFn (params, result) ->
      let param_string param =
        match param with
        | TFn _ | TVariadicFn _ -> Printf.sprintf "(%s)" (ty_to_string param)
        | _ -> ty_to_string param
      in
      String.concat " -> "
        (List.map param_string params @ [ ty_to_string result ])
  | TVariadicFn (params, rest, result) ->
      let param_string param =
        match param with
        | TFn _ | TVariadicFn _ -> Printf.sprintf "(%s)" (ty_to_string param)
        | _ -> ty_to_string param
      in
      String.concat " -> "
        (List.map param_string params
        @ [ Printf.sprintf "%s..." (param_string rest); ty_to_string result ])
  | TMacro -> "Macro"
  | TDeclaration -> "Declaration"
  | TTypeValue -> "TypeValue"
  | TNamed name -> name
  | TNamedApp (name, args) ->
      Printf.sprintf "%s<%s>" name
        (String.concat ", " (List.map ty_to_string args))
  | TApp (callee, args) ->
      Printf.sprintf "%s<%s>" (ty_to_string callee)
        (String.concat ", " (List.map ty_to_string args))
  | TFormDescriptor -> "FormDescriptor"
  | TProtocolDescriptor -> "ProtocolDescriptor"

let ty_to_diagnostic_string = function
  | TString -> "String"
  | ty -> ty_to_string ty

let string_json = Value.string_json

let list_json encode values =
  Printf.sprintf "[%s]" (String.concat "," (List.map encode values))

let named_json name =
  Printf.sprintf "{\"kind\":\"named\",\"name\":%s,\"display\":%s}"
    (string_json name) (string_json name)

let rec to_json ty =
  match ty with
  | TVar id ->
      let display = ty_to_string ty in
      Printf.sprintf "{\"kind\":\"var\",\"id\":%d,\"display\":%s}" id
        (string_json display)
  | TInt -> named_json "Int"
  | TFloat -> named_json "Number"
  | TBool -> named_json "Bool"
  | TString -> named_json "String"
  | TNil -> named_json "Unit"
  | TKeyword -> named_json "Keyword"
  | TSymbol -> named_json "Symbol"
  | TSyntax -> named_json "Syntax"
  | TAny -> named_json "Any"
  | TMap -> named_json "Map"
  | TMacro -> named_json "Macro"
  | TDeclaration -> named_json "Declaration"
  | TTypeValue -> named_json "TypeValue"
  | TNamed name -> named_json name
  | TNamedApp (name, args) ->
      let display = ty_to_string ty in
      Printf.sprintf
        "{\"kind\":\"named-application\",\"name\":%s,\"args\":%s,\"display\":%s}"
        (string_json name) (list_json to_json args) (string_json display)
  | TApp (callee, args) ->
      let display = ty_to_string ty in
      Printf.sprintf
        "{\"kind\":\"application\",\"callee\":%s,\"args\":%s,\"display\":%s}"
        (to_json callee) (list_json to_json args) (string_json display)
  | TFormDescriptor -> named_json "FormDescriptor"
  | TProtocolDescriptor -> named_json "ProtocolDescriptor"
  | TList item ->
      Printf.sprintf "{\"kind\":\"list\",\"item\":%s,\"display\":%s}"
        (to_json item) (string_json (ty_to_string ty))
  | TVector item ->
      Printf.sprintf "{\"kind\":\"list\",\"item\":%s,\"display\":%s}"
        (to_json item) (string_json (ty_to_string ty))
  | TOpenRecord (fields,tail) ->
      let field_json (label,t) = Printf.sprintf "{\"label\":%s,\"type\":%s}" (string_json label) (to_json t) in
      Printf.sprintf "{\"kind\":\"record\",\"fields\":%s,\"tail\":%s,\"display\":%s}" (list_json field_json fields) (to_json tail) (string_json (ty_to_string ty))
  | TRecord fields ->
      let field_json (label, ty) =
        Printf.sprintf "{\"label\":%s,\"type\":%s}" (string_json label)
          (to_json ty)
      in
      Printf.sprintf "{\"kind\":\"record\",\"fields\":%s,\"display\":%s}"
        (list_json field_json fields) (string_json (ty_to_string ty))
  | TFn (params, result) ->
      Printf.sprintf
        "{\"kind\":\"function\",\"params\":%s,\"return\":%s,\"display\":%s}"
        (list_json to_json params) (to_json result)
        (string_json (ty_to_string ty))
  | TVariadicFn (params, rest, result) ->
      Printf.sprintf
        "{\"kind\":\"variadic-function\",\"params\":%s,\"rest\":%s,\"return\":%s,\"display\":%s}"
        (list_json to_json params) (to_json rest) (to_json result)
        (string_json (ty_to_string ty))

let rec free_ty = function
  | TVar id -> [ id ]
  | TList item | TVector item -> free_ty item
  | TOpenRecord (fields,tail) -> List.concat_map (fun (_,t)->free_ty t) fields @ free_ty tail |> List.sort_uniq Int.compare
  | TRecord fields ->
      fields
      |> List.concat_map (fun (_, ty) -> free_ty ty)
      |> List.sort_uniq Int.compare
  | TFn (args, result) ->
      List.concat_map free_ty args @ free_ty result
      |> List.sort_uniq Int.compare
  | TVariadicFn (args, rest, result) ->
      List.concat_map free_ty args @ free_ty rest @ free_ty result
      |> List.sort_uniq Int.compare
  | TApp (callee, args) ->
      free_ty callee @ List.concat_map free_ty args
      |> List.sort_uniq Int.compare
  | TNamedApp (_, args) ->
      List.concat_map free_ty args |> List.sort_uniq Int.compare
  | TInt | TFloat | TBool | TString | TNil | TKeyword | TSymbol | TSyntax | TAny
  | TMap | TMacro | TDeclaration | TTypeValue | TNamed _ | TFormDescriptor
  | TProtocolDescriptor ->
      []

let rec apply_subst subst ty =
  match ty with
  | TVar id -> (
      match List.assoc_opt id subst with
      | Some replacement -> apply_subst subst replacement
      | None -> ty)
  | TList item -> TList (apply_subst subst item)
  | TVector item -> TVector (apply_subst subst item)
  | TOpenRecord (fields,tail) ->
      let fields=List.map (fun (k,t)->k,apply_subst subst t) fields in
      let merge extra=List.sort (fun (a,_) (b,_) -> String.compare a b) (fields @ extra) in
      (match apply_subst subst tail with
       | TRecord extra -> TRecord (merge extra)
       | TOpenRecord (extra,tail) -> TOpenRecord (merge extra,tail)
       | tail -> TOpenRecord (fields,tail))
  | TRecord fields ->
      TRecord
        (List.map (fun (label, ty) -> (label, apply_subst subst ty)) fields)
  | TFn (args, result) ->
      TFn (List.map (apply_subst subst) args, apply_subst subst result)
  | TVariadicFn (args, rest, result) ->
      TVariadicFn
        ( List.map (apply_subst subst) args,
          apply_subst subst rest,
          apply_subst subst result )
  | TNamedApp (name, args) -> TNamedApp (name, List.map (apply_subst subst) args)
  | TApp (callee, args) ->
      TApp (apply_subst subst callee, List.map (apply_subst subst) args)
  | TInt | TFloat | TBool | TString | TNil | TKeyword | TSymbol | TSyntax | TAny
  | TMap | TMacro | TDeclaration | TTypeValue | TNamed _ | TFormDescriptor
  | TProtocolDescriptor ->
      ty

let compose_subst newer older =
  List.map (fun (var, ty) -> (var, apply_subst newer ty)) older @ newer

let sort_record_fields fields =
  List.sort (fun (left, _) (right, _) -> String.compare left right) fields

let upsert_record_field label ty fields =
  (label, ty) :: List.remove_assoc label fields |> sort_record_fields

let merge_record_fields left right =
  List.fold_left
    (fun fields (label, ty) -> upsert_record_field label ty fields)
    left right

let remove_record_fields labels fields =
  fields
  |> List.filter (fun (label, _) -> not (List.mem label labels))
  |> sort_record_fields

let select_record_fields labels fields =
  fields
  |> List.filter (fun (label, _) -> List.mem label labels)
  |> sort_record_fields
