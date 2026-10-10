;; Values TypeScript or Effect cannot represent faithfully.
(: huge Number)
(define huge 1e400)

;; Unsafe Int literals are rejected by the reader (numeric-types.test.ts).


(: weights (Map String Int))
(define weights {"__proto__" 1 "a" 2 "b" 3})

(: seen (Map String Unit))
(define seen {"a" nil})

(error Broken {:_tag String})
