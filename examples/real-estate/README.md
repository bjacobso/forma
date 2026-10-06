---
id: real-estate
version: 0.1.0
preludes:
  - core
---

# Real Estate

Listings and agents example in canonical ontology syntax.

```lisp
(entity Agent {:name String :market (Option String)})
(entity Listing {:address String :status String :agent (Option (Id Agent))})
```

```lisp
(seed Agent "agent:noah" {:name "Noah Bennett" :market "Austin"})
(seed Listing "listing:oakhill"
  {:address "18 Oakhill Drive" :status "active" :agent "agent:noah"})
```

```lisp
(query active-listings
  :from Listing
  :where (= status "active")
  :select [address status agent])
```
