; email.lisp
; -----------------------------------------------------------------------------
; Purpose: Typed email decisions, predicates, and automation-rule declarations.
; Requires: compiler.lisp; the email linker supplies each rule's EmailLane vocabulary.
; Used by: The optional TypeScript email linker; scheduling and rate enforcement belong to hosts.
; -----------------------------------------------------------------------------

; Host-supplied recipient facts; due-in maps journey names to hours until
; their next scheduled email.
(type EmailContact
  {:email String :domain String :tags (List String) :due-in (Map String Int)})

; Every rule answers each contact with exactly one decision.
(type EmailDecision
  (Tagged (Send {:lane EmailLane}) (Defer {:hours Int}) (Skip {:reason String})))

; Returns a Send decision; delivery happens in the host's checked operation.
(: send (-> EmailLane EmailDecision))
(define send [lane] (Send {:lane lane}))

; Returns a Defer decision measured in hours.
(: defer (-> Int EmailDecision))
(define defer [hours] (Defer {:hours hours}))

; Returns a Skip decision retaining the author's reason.
(: skip (-> String EmailDecision))
(define skip [reason] (Skip {:reason reason}))

; Predicates take the contact first; rules omit it.
(: tag? (-> EmailContact String Bool))
(define tag? [contact tag] (includes? contact.tags tag))

; Tests the recipient's domain for exact string equality.
(: domain? (-> EmailContact String Bool))
(define domain? [contact domain] (= contact.domain domain))

; Tests whether a known journey is due within the supplied hours; an absent
; journey returns false.
(: due? (-> EmailContact String Int Bool))
(define due? [contact journey hours]
  (match (get contact.due-in journey)
    (Some next) (<= next hours)
    None false))

(type EmailRuleIR
  {:kind "EmailRule" :name String :lanes RuntimeExpr :clauses (List RuntimeExpr)})

(form (rule name lanes clause ...)
  "Declares an email rule with lane configuration and decision clauses. The
   email linker checks predicates and decisions and lowers the rule to
   Effect code."
  :examples
    [[(rule "welcome" (lanes (lane "default" :per-hour 100))
        (when (tag? "customer") (skip "Already a customer"))
        (send "default"))]]
  :types {:name String :lanes Syntax :clause (List Syntax)}
  :ir EmailRuleIR
  :emit (fn [ir]
    `{:name ~(get ir :name)
      :decide ~(ts/operation (get ir :name))
      :perHour ~(ts/operation "email-lane-per-hour")})
  {:kind "EmailRule" :name name :lanes lanes :clauses clause})
