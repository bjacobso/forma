(* Located authoring errors found while lowering surface syntax. Raise these at
   the point of detection; stdlib exceptions are never user diagnostics. *)
exception Invalid_form of Ast.span * string

let invalid span message = raise (Invalid_form (span, message))
