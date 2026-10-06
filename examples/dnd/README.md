---
id: dnd
version: 0.1.0
preludes:
  - core
---

# D&D

Tabletop campaign example in canonical ontology syntax.

```lisp
(entity Campaign {:name String
    :tier (Option String)})

(entity Character {:name String
    :class (Option String)
    :campaign (Option (Id Campaign))})
```

```lisp
(seed Campaign "campaign:shattered-sea" {:name "Shattered Sea"
  :tier "mid"})

(seed Character "character:orin" {:name "Orin Vale"
  :class "bard"
  :campaign "campaign:shattered-sea"})
```

```lisp
(query party
  :from Character
  :select [name class campaign])
```
