(type (Option a) (Tagged (Some a) None))
(match (Some 42)
  (Some x) x
  (Some y) y
  (None) 0)
