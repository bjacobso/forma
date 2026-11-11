; Six valid expenses plus deliberate violations. This file MUST fail checking.
(import "./expenses-valid.lisp" [])
(import "./expenses-forms.lisp" [expense])
(expense unlicensed :employee "alice" :amount 9000 :category "software" :date 20771)
(expense untagged :employee "bob" :amount 9000 :category "equipment" :date 20771)
(expense self-managed :employee "carol" :amount 8000 :category "meals" :date 20771 :manager "carol")
(expense self-financed :employee "dana" :amount 300000 :category "travel" :date 20771 :finance "dana")
