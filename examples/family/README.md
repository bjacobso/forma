---
id: family
version: 0.1.0
preludes:
  - core
---

# Family

Family relationships example in canonical ontology syntax.

```lisp
(entity Household {:name String})

(entity Person {:name String
    :role (Option String)
    :household (Option (Id Household))})
```

```lisp
(seed Household "household:rivera" {:name "Rivera Household"})

(seed Person "person:maya" {:name "Maya Rivera"
  :role "parent"
  :household "household:rivera"})
```

```lisp
(query household-members
  :from Person
  :select [name role household])
```
