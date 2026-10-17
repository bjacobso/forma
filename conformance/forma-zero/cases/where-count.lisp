; layer 1 — a single-pattern query finds every match
(count
  (where (concat ["e"] [])
    (concat [["e" "type" "employee"]] [])
    (concat
      [
        ["ben" "type" "employee"]
        ["alice" "type" "employee"]
        ["onboarded" "type" "employer"]]
      [])))
