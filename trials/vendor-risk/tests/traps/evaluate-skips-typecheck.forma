(type Risk (Union :low :high))
(type Vendor {:name String :risk Risk :soc2-until (Option Int)})
(: v Vendor)
(define v {:name "Acme" :risk :high})
(define soc2-ok? [vendor today]
  (match vendor.soc2-until
    (Some until) (> until today)
    None false))
[(soc2-ok? v 100) (= :high "high") (= 2 2.0)]
