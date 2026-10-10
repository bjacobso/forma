(type Person {:name String :age Int})
(: person (Pick Person [:name]))
(define person {:name "Ada"})
person
