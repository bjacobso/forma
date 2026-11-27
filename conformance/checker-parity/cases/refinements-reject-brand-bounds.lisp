;; Shared contract: brand constructor rejects a literal outside :min/:max.
(type Bags (Brand (Int :min 1 :max 200)))

(: empty-bags Bags)
(define empty-bags (Bags 0))
