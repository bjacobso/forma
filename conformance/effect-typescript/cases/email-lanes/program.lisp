; Rejects malformed and duplicate lanes.
(rule "launch-warmup-3"
  (lanes
    (lane "gmail"   :per-hour 2000)
    (lane "gmail" :per-hour 0)
    (lane "gmail" :per-hour 16000)
    (lane "bulk"))
  (when (due? "value-path" 6h) (defer 6h))
  (when (tag? "customer") (skip "already bought"))
  (when (domain? "gmail.com") (send "gmail"))
  (send "default"))

(error RateLimited {:retry-in-hours Int})
(error Bounced {:reason String})
(service Mailer
  (: deliver (-> EmailLane String (Effect Unit [RateLimited Bounced]))))

(: run-warmup (-> EmailContact (Effect EmailDecision [] [Mailer.deliver])))
(define run-warmup [contact]
  (let [decision (launch-warmup-3 contact)]
    (match decision
      (EmailDecision.Send s)
        (catch (do (Mailer.deliver s.lane contact.email) decision)
          (RateLimited e) (defer e.retry-in-hours)
          (Bounced e) (skip e.reason))
      (EmailDecision.Defer d) decision
      (EmailDecision.Skip s) decision)))
