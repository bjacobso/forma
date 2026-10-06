---
id: insurance
version: 0.1.0
preludes:
  - core
---

# Insurance

Insurance policy and claims example in canonical ontology syntax.

```lisp
(entity PolicyHolder {:name String :segment (Option String)})
(entity Claim
  {
    :status String
    :amount (Option Number)
    :policy-holder (Option (Id PolicyHolder))})
```

```lisp
(seed PolicyHolder "policy-holder:acme"
  {:name "Acme Manufacturing" :segment "commercial"})
(seed Claim "claim:wind"
  {:status "open" :amount 42000 :policy-holder "policy-holder:acme"})
```

```lisp
(query open-claims
  :from Claim
  :where (= status "open")
  :select [status amount policy-holder])
```
