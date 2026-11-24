;; Shared contract: Int widens to Float in assignments and branch joins,
;; while pure Int arithmetic remains Int and division yields Float.
(: int-value Int)
(define int-value 42)

(: widened-float Float)
(define widened-float 42)

(: explicit-float Float)
(define explicit-float 1.5)

(: add-ints (-> Int Int Int))
(define add-ints [a b] (+ a b))

(: divide-ints (-> Int Int Float))
(define divide-ints [a b] (/ a b))

(: mixed-join (-> Bool Float))
(define mixed-join [flag]
  (if flag 1 2.5))

(: promote-param (-> Int Float))
(define promote-param [n] n)
