# Filtered Query

```lisp
(export active-employees)

(query active-employees
  :from Employee
  :where (match status (Some __status) (= __status "active") None false)
  :select [name status])
```
