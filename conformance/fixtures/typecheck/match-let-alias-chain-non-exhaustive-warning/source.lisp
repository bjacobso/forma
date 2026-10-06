(type (Option a) (Tagged (Some a) None))
(let [first (Some 42)
      second first]
  (match second
    (Some x) x))
