(: combine (-> {:name String} {:age Int} (Merge {:name String} {:age Int})))
(define combine [left right] (merge left right))
(combine {:name "Ada"} {:age 37})
