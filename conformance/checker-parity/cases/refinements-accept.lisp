;; Shared contract: compile-time literal refinements accept in-range literals
;; across direct annotations, brands, record fields, call arguments, and accept
;; computed values without requiring static proofs (RFC 0019 section 11).
(type Cents (Int :min 0))
(type Bags (Brand (Int :min 1 :max 200)))
(type Sku (String :pattern "^[A-Z]+-[0-9]+$"))
(type Code (String :min-length 2 :max-length 4))
(type Ratio (Float :min 0.0 :max 1.0 :finite true))
(type Line {:sku Sku :bags Bags :code Code})

(: zero-cents Cents)
(define zero-cents 0)

(: valid-bags Bags)
(define valid-bags (Bags 200))

(: valid-ratio Ratio)
(define valid-ratio 0.5)

(: int-as-ratio Ratio)
(define int-as-ratio 1)

(: valid-line Line)
(define valid-line {:sku "BEAN-1" :bags (Bags 7) :code "AB"})

(: take-cents (-> Cents Int))
(define take-cents [c] c)

(: used-cents Int)
(define used-cents (take-cents 42))

(: computed-cents (-> Int Cents))
(define computed-cents [n] (+ n 1))

(: computed-bags (-> Int Bags))
(define computed-bags [n] (Bags n))
