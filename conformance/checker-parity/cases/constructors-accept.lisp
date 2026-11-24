;; Shared contract: tagged union constructors retain their union type across
;; let bindings, conditional branches, and list literals.
(type Ev (Tagged (Placed {:id String}) (Billed {:amount Int}) (Acked {:to String})))

(: build-events (-> String Bool (List Ev)))
(define build-events [id acked]
  (let [placed (Ev.Placed {:id id})]
    (concat [placed (Ev.Billed {:amount 42})]
      (if acked [(Ev.Acked {:to "buyer"})] []))))

(: pick-event (-> Bool Ev))
(define pick-event [billed]
  (if billed
    (Ev.Billed {:amount 10})
    (Ev.Placed {:id "ord-1"})))
