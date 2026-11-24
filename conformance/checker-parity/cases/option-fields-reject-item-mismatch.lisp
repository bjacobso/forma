;; Shared contract: an Option field rejects Some with the wrong item type.
(type Stage {:note (Option String) :n Int})

(: bad-option Stage)
(define bad-option {:note (Some 12) :n 1})
