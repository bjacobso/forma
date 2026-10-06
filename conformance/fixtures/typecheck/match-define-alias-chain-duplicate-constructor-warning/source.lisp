(type (Option a) (Tagged (Some a) None))
(define first (Some 42))
(define second first)
(match second
  (Some x) x
  (Some y) y
  (None) 0)
