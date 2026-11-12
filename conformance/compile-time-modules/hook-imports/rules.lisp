;; Ordinary helpers, written without any knowledge of forms. They use a kernel
;; macro (`or`), an inner `fn`, and a signature whose body applies a lambda.
(import "../../../preludes/modules/kernel.lisp" [or])
(export limit within-limit? next-day)
(define limit 100)
(: next-day (-> Int Int))
(define next-day [day] ((fn [d] (+ d 1)) day))
(define within-limit? [amount] (or (= amount 0) (<= amount limit)))
