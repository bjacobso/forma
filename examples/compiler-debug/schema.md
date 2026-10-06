# Schema

```lisp
(export Department Employee)
(entity Department {:name String :code (Option String)})
(entity Employee
  {:name String :status (Option String) :department (Option (Id Department))})
```
