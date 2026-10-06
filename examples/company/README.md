---
id: company
version: 0.1.0
preludes:
  - core
---

# Company

Core company org example in canonical ontology syntax.

```lisp
(entity Department {:name String
    :cost-center (Option String)})

(entity Employee {:name String
    :title (Option String)
    :department (Option (Id Department))})
```

```lisp
(seed Department "department:engineering" {:name "Engineering"
  :cost-center "1001"})

(seed Department "department:finance" {:name "Finance"
  :cost-center "2001"})

(seed Employee "employee:alice" {:name "Alice Chen"
  :title "VP Engineering"
  :department "department:engineering"})

(seed Employee "employee:mario" {:name "Mario Ruiz"
  :title "Controller"
  :department "department:finance"})
```

```lisp
(query employee-directory
  :from Employee
  :select [name title department])
```
