;; A record type with an optional field, used from another module.
(export Review)
(type Review {:vendor String :score (Option Int)})
