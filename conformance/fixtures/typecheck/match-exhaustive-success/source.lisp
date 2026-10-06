(type (Option a) (Tagged (Some a) None))
(match (Some 42)
  (Some x) x
  (None) 0)
