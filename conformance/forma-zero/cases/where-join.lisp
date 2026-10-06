; layer 1 — conjunction joins on the shared variable
(binding-value (first (where (concat ["e"] [])
                   (concat [["e" "type" "employee"]
                        ["e" "submitted" "i9"]] [])
                   (concat [["ben" "type" "employee"]
                        ["alice" "type" "employee"]
                        ["ben" "submitted" "i9"]] [])))
     "e")
