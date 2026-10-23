; Email automation rule vocabulary. The optional TypeScript linker lowers a
; rule through the existing Effect checker; neither engine's core knows about
; contacts, lanes, or sending.
; Everything a rule can say is an ordinary typed definition in this file. The
; linker adds the rule's lanes as EmailLane, passes the rule's contact to
; predicates, and reads 6h or 2d as hours.

; What a rule can see about one recipient. Hosts compute these fields.
; :due-in maps a journey name to the hours until its next scheduled email.
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
