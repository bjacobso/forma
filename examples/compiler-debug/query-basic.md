# Basic Query

```lisp
(export employee-directory)

(query employee-directory
  :from Employee
  :select [name status department])
```
