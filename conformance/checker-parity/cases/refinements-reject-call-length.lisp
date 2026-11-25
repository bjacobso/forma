;; Shared contract: call argument rejects a string literal exceeding :max-length.
(type Code (String :min-length 2 :max-length 3))

(: use-code (-> Code String))
(define use-code [c] c)

(: bad String)
(define bad (use-code "abcd"))
