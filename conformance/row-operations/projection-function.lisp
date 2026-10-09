(type Person {:name String :age Int})
(: public-name (-> Person (Pick Person [:name])))
(define public-name [person] (select-keys person [:name]))
(public-name {:name "Ada" :age 37})
