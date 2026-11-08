(type Risk (Union :low :high))
(type Vendor {:name String :risk Risk :reviewed-on (Option Int)})

(: reviewed? (-> Vendor Bool))
(define reviewed? [vendor]
  (match vendor.reviewed-on
    (Some day) (>= day 0)
    None false))

(: acme Vendor)
(define acme {:name "Acme" :risk :high :reviewed-on 900})

(reviewed? acme)
