---
id: fantasy
version: 0.1.0
preludes:
  - core
---

# Fantasy

Fantasy realm example in canonical ontology syntax.

```lisp
(entity Realm {:name String
    :element (Option String)})

(entity Hero {:name String
    :class (Option String)
    :realm (Option (Id Realm))})
```

```lisp
(seed Realm "realm:emberfall" {:name "Emberfall"
  :element "fire"})

(seed Hero "hero:lyra" {:name "Lyra"
  :class "warden"
  :realm "realm:emberfall"})
```

```lisp
(query heroes
  :from Hero
  :select [name class realm])
```
