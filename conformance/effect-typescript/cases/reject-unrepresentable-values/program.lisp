;; Values TypeScript or Effect cannot represent faithfully.
(: huge Number)
(define huge 1e400)

(: unsafe Int)
(define unsafe 9007199254740993)

(: weights (Map Int))
(define weights {"__proto__" 1 "a" 2 "a" 3})

(: seen (Map Unit))
(define seen {"a" nil})

(define-error Broken (:fields (field _tag String)))

(define-schema Shape
  (TaggedUnion kind
    [circle (Struct (field kind String) (field radius Number))]))
