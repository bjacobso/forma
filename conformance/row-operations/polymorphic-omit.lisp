(type (Kept a) (Omit {:value a :unused Bool} [:unused]))
(: read (-> (Kept a) a))
(define read [record] record.value)
(let [_ (read {:value true})] (read {:value "ok"}))
