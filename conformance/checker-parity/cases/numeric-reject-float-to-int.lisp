;; Shared contract: Float literals do not narrow to Int.
(: bad-int Int)
(define bad-int 1.5)
