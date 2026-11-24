;; RFC 0023: a wrapper passes its callback's errors and requirements through
;; and adds its own. `e` is an error-set variable and `r` a requirement-set
;; variable, solved afresh at every call.
(error Declined {:reason String})
(error AuditDown)
(service Stripe (: charge (-> Int (Effect String [Declined] []))))
(service Audit (: log (-> String (Effect Unit [AuditDown] []))))

(: charge (-> Int (Effect String [Declined] [Stripe.charge])))
(define charge [n] (Stripe.charge n))

(: lookup-cached (-> Int (Effect String)))
(define lookup-cached [n] (succeed (str "cached-" n)))

(: with-audit
  (-> (-> Int (Effect a [e] [r])) Int
      (Effect a [e AuditDown] [r Audit.log])))
(define with-audit [f n]
  (do! [v (f n)
        _ (Audit.log "called")]
    v))

(: charged (-> Int (Effect String [Declined AuditDown] [Stripe.charge Audit.log])))
(define charged [n] (with-audit charge n))

(: charged-inline (-> Int (Effect String [Declined AuditDown] [Stripe.charge Audit.log])))
(define charged-inline [n] (with-audit (fn [m] (Stripe.charge m)) n))

(: free (-> Int (Effect String [AuditDown] [Audit.log])))
(define free [n] (with-audit lookup-cached n))

(: free-inline (-> Int (Effect String [AuditDown] [Audit.log])))
(define free-inline [n] (with-audit (fn [m] (lookup-cached m)) n))
