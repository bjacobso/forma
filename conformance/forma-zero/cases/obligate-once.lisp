; layers 2+4 — the constraint reconciler emits each obligation exactly once
; and the reaction cascade terminates (the must-fact does not retrigger itself)
(let
  [
    log
    (concat
      [
        ["alice" "type" "employee"]
        (grant "root" "submitted")
        (grant "system" "must")]
      [])
    i9-required
    (make-obligate (concat ["e"] [])
      (concat [["e" "type" "employee"]] [])
      (concat [["e" "submitted" "i9"]] [])
      "e"
      "submit-i9")
    final
    (opeval log
      (concat [{:fact ["ben" "submitted" "handbook"] :by "root"}] [])
      (concat [i9-required] []))]
  (count
    (where (concat ["s"] []) (concat [["s" "must" "submit-i9"]] []) final)))
