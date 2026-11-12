(import "forma:kernel" [and not])
(export accepted?)
(: accepted? (-> Int Bool))
(define accepted? [value] (and (> value 0) (not (= value 7))))
