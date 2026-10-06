# Basic Action

```lisp
(export mark-active)
(: mark-active (-> Employee (Action Bool)))
(define
  mark-active
  [employee]
  (do! [_ (update! Employee employee.id {:status "active"})] true))
```
