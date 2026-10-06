---
id: movies
version: 0.1.0
preludes:
  - core
---

# Movies

Movies catalog example in canonical ontology syntax.

```lisp
(entity Studio {:name String})
(entity Movie
  {:title String :release-year (Option Number) :studio (Option (Id Studio))})
```

```lisp
(seed Studio "studio:a24" {:name "A24"})
(seed Movie "movie:past-lives"
  {:title "Past Lives" :release-year 2023 :studio "studio:a24"})
```

```lisp
(query releases :from Movie :select [title release-year studio])
```
