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

val fresh_tyvar : unit -> ty
val ty_to_string : ty -> string
val ty_to_diagnostic_string : ty -> string
val to_json : ty -> string
val free_ty : ty -> int list
val apply_subst : subst -> ty -> ty
val compose_subst : subst -> subst -> subst
val sort_record_fields : (string * ty) list -> (string * ty) list

val upsert_record_field :
  string -> ty -> (string * ty) list -> (string * ty) list

val merge_record_fields :
  (string * ty) list -> (string * ty) list -> (string * ty) list

val remove_record_fields :
  string list -> (string * ty) list -> (string * ty) list

val select_record_fields :
  string list -> (string * ty) list -> (string * ty) list
