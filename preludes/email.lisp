; email.lisp
; -----------------------------------------------------------------------------
; Purpose: Typed email decisions, predicates, and automation-rule declarations.
; Requires: compiler.lisp; the email linker supplies each rule's EmailLane vocabulary.
; Used by: The optional TypeScript email linker; scheduling and rate enforcement belong to hosts.
; -----------------------------------------------------------------------------

(type EmailContact
  {:email String :domain String :tags (List String) :due-in (Map String Int)})

; Every rule answers each contact with exactly one decision.
(type EmailDecision
  (Tagged (Send {:lane EmailLane}) (Defer {:hours Int}) (Skip {:reason String})))

(: send (-> EmailLane EmailDecision))
(define send [lane] (Send {:lane lane}))

(: defer (-> Int EmailDecision))
(define defer [hours] (Defer {:hours hours}))

(: skip (-> String EmailDecision))
(define skip [reason] (Skip {:reason reason}))

; Predicates take the contact first; rules omit it.
(: tag? (-> EmailContact String Bool))
(define tag? [contact tag] (includes? contact.tags tag))

(: domain? (-> EmailContact String Bool))
(define domain? [contact domain] (= contact.domain domain))

(: due? (-> EmailContact String Int Bool))
(define due? [contact journey hours]
  (match (get contact.due-in journey)
    (Some next) (<= next hours)
    None false))

(type EmailRuleIR
  {:kind "EmailRule" :name String :lanes RuntimeExpr :clauses (List RuntimeExpr)})

(form (rule name lanes clause ...)
  :types {:name String :lanes Syntax :clause (List Syntax)}
  :ir EmailRuleIR
  :emit (fn [ir]
    `{:name ~(get ir :name)
      :decide ~(ts/operation (get ir :name))
      :perHour ~(ts/operation "email-lane-per-hour")})
  {:kind "EmailRule" :name name :lanes lanes :clauses clause})
