---
id: bookstore
version: 0.1.0
preludes:
  - core
---

# Bookstore

Bookstore catalog example in canonical ontology syntax.

```lisp
(entity Author {:name String})

(entity Book {:title String
    :genre (Option String)
    :author (Option (Id Author))})
```

```lisp
(seed Author "author:le-guin" {:name "Ursula K. Le Guin"})

(seed Book "book:earthsea" {:title "A Wizard of Earthsea"
  :genre "fantasy"
  :author "author:le-guin"})
```

```lisp
(query catalog
  :from Book
  :select [title genre author])
```
