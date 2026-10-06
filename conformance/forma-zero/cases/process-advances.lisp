; layers 3+4 — the step graph is facts in the log; the one generic
; workflow reaction queries the graph it is executing
(let [log (concat [["i9" "next" "handbook"]
               (grant "root" "completed")
               (grant "system" "now")] [])
      final (opeval log
                    (concat [{:fact ["maria" "completed" "i9"] :by "root"}] [])
                    (concat [advance] []))]
  (binding-value (first (where (concat ["s"] []) (concat [["maria" "now" "s"]] []) final)) "s"))
