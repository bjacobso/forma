; layer 1 — negation-as-absence: the employee who has NOT submitted an i9
(binding-value (first (without (concat ["e"] [])
                     (concat [["e" "type" "employee"]] [])
                     (concat [["e" "submitted" "i9"]] [])
                     (concat [["ben" "type" "employee"]
                          ["alice" "type" "employee"]
                          ["ben" "submitted" "i9"]] [])))
     "e")
