;; RFC 0019 section 11: a literal is held to its refinements where it is written.
(type Cents (Int :min 0))
(type Bags (Brand (Int :min 1 :max 200)))
(type Sku (String :pattern "^[A-Z]+-[0-9]+$"))
(type Line {:sku Sku :bags Bags})

(: refund Cents)
(define refund -5)

(: nothing (-> Int (Effect Bags [] [])))
(define nothing [n] (succeed (Bags 0)))

(: line (-> Int (Effect Line [] [])))
(define line [n] (succeed {:sku "bean-1" :bags (Bags 7)}))

(: fine (-> Int (Effect Line [] [])))
(define fine [n] (succeed {:sku "BEAN-1" :bags (Bags 200)}))
