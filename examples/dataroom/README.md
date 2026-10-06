---
id: dataroom
version: 0.1.0
preludes:
  - core
---

# Data Room

Secure deal room example in canonical ontology syntax.

```lisp
(entity Room {:name String
    :stage String})

(entity Document {:title String
    :classification (Option String)
    :room (Option (Id Room))})
```

```lisp
(seed Room "room:series-b" {:name "Series B"
  :stage "due-diligence"})

(seed Document "document:financials" {:title "FY25 Financials"
  :classification "confidential"
  :room "room:series-b"})
```

```lisp
(query room-documents
  :from Document
  :select [title classification room])
```
