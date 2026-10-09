(type (Envelope a) (Merge {:value a} {:id Int}))
(: read (-> (Envelope a) a))
(define read [record] record.value)
(let [_ (read {:id 1 :value true})] (read {:id 2 :value "ok"}))
