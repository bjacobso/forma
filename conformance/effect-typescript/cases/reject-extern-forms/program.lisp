; Malformed extern forms: a module that is not a string, a Forma
; implementation inside extern, an :export that is not a TypeScript
; identifier, and one name imported from two modules.
(extern Payments
  (: charge (-> String (Effect Unit))))
(extern "./payments.js"
  (define format-cents [cents] (str cents)))
(extern "./payments.js"
  (: slug (-> String String) :export "to-slug"))
(extern "./rates.js" (: currency String))
(extern "./currency.js" (: currency String))
