(: person (Pick {:name String :nickname (Option String)} [:nickname]))
(define person {:nickname (Some "Ada")})
person
