; layer 2 — a constraint is a fold: the violation set is a derived value
(count
  (violations (concat ["e"] [])
    (concat [["e" "type" "employee"]] [])
    (concat [["e" "submitted" "i9"]] [])
    "e"
    (concat
      [
        ["ben" "type" "employee"]
        ["alice" "type" "employee"]
        ["ben" "submitted" "i9"]]
      [])))
