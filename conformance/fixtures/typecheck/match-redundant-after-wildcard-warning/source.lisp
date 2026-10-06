(type (Option a) (Tagged (Some a) None))
(match (Some 42)
  _ 0
  (Some x) x
  (None) 0)
