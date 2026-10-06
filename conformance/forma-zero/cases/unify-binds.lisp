; layer 1 — unification binds a variable to the matching slot
(binding-value (first (unify (concat ["e"] [])
                   ["ben" "works-for" "e"]
                   ["ben" "works-for" "onboarded"]
                   empty-env))
     "e")
