---
id: hr
version: 0.1.0
preludes:
  - core
---

# HR

HR onboarding example in canonical ontology syntax.

```lisp
(entity Candidate {:name String
    :email (Option String)
    :status String})

(entity Offer {:title String
    :status String
    :candidate (Option (Id Candidate))})
```

```lisp
(seed Candidate "candidate:sam" {:name "Sam Patel"
  :email "sam@example.com"
  :status "interviewing"})

(seed Candidate "candidate:taylor" {:name "Taylor Brooks"
  :email "taylor@example.com"
  :status "hired"})

(seed Offer "offer:taylor" {:title "Customer Success Manager"
  :status "accepted"
  :candidate "candidate:taylor"})
```

```lisp
(query active-offers
  :from Offer
  :select [title status candidate])
```
