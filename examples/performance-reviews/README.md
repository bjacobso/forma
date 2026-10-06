---
id: performance-reviews
version: 0.1.0
preludes:
  - core
---

# Performance Reviews

Performance review cycle example in canonical ontology syntax.

```lisp
(entity ReviewCycle {:name String :status String})
(entity Review
  {
    :employee-name String
    :rating (Option Number)
    :cycle (Option (Id ReviewCycle))})
```

```lisp
(seed ReviewCycle "cycle:2026-h1" {:name "2026 H1" :status "open"})
(seed Review "review:alex"
  {:employee-name "Alex Kim" :rating 4.5 :cycle "cycle:2026-h1"})
```

```lisp
(query review-ratings :from Review :select [employee-name rating cycle])
```
