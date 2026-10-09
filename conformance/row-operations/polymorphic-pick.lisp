(type (Selected a) (Pick {:value a :unused Bool} [:value]))
(: read (-> (Selected a) a))
(define read [record] record.value)
(let [_ (read {:value 1})] (read {:value "ok"}))
