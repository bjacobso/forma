;; Shared contract: a mixed Int/Float branch join produces Float and cannot narrow to Int.
(: bad-join (-> Bool Int))
(define bad-join [flag]
  (if flag 1 2.0))
