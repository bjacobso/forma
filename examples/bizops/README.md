---
id: bizops
version: 0.1.0
preludes:
  - core
---

# BizOps

Revenue and operations example in canonical ontology syntax.

```lisp
(entity Account {:name String :segment (Option String)})
(entity Invoice
  {:status String :amount (Option Number) :account (Option (Id Account))})
```

```lisp
(seed Account "account:northstar"
  {:name "Northstar Health" :segment "enterprise"})
(seed Invoice "invoice:1001"
  {:status "open" :amount 18500 :account "account:northstar"})
```

```lisp
(query revenue-open-invoices
  :from Invoice
  :where (= status "open")
  :select [status amount account])
```
