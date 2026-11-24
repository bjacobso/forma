(import "./types.lisp" [Tier Invoice Summary])
(import "./billing.lisp" [net-amount tier-surcharge format-label summarize])
(export Tier Invoice Summary net-amount tier-surcharge format-label summarize)
(summarize {:id "inv-1" :subtotal 1000 :discount 100 :tier :priority :note (Some " Q1 ")})
