---
id: chronicle
version: 0.1.0
preludes:
  - core
---

# Chronicle

Narrative event log example in canonical ontology syntax.

```lisp
(entity Chronicle {:title String :theme (Option String)})
(entity Entry
  {:title String :era (Option String) :chronicle (Option (Id Chronicle))})
```

```lisp
(seed Chronicle "chronicle:founding" {:title "Founding Era" :theme "origins"})
(seed Entry "entry:arrival"
  {
    :title "Arrival of the Archive Fleet"
    :era "year-zero"
    :chronicle "chronicle:founding"})
```

```lisp
(query chronicle-entries :from Entry :select [title era chronicle])
```
