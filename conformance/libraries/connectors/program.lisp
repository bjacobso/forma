(import "./connectors.lisp" [connector machine])

(connector Stripe "Payment processor"
  :capabilities [charge refund]
  :signals [webhook]
  :owns [PaymentFlow])

(machine PaymentFlow "Tracks a card charge lifecycle"
  :signal webhook
  :initial pending
  :final [settled failed]
  (state pending "Pending")
  (state settled "Settled")
  (state failed "Failed")
  (transition pending settled)
  (transition pending failed))
