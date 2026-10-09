(type Person {:name String :age Int})
(: person (Omit Person [:age]))
(define person {:name "Ada"})
person
