;; Shared contract: record field rejects a string literal failing :pattern.
(type Sku (String :pattern "^[A-Z]+-[0-9]+$"))
(type Line {:sku Sku})

(: bad-line Line)
(define bad-line {:sku "bean-1"})
