(define grade
  (fn [score]
    (cond
      (>= score 90)
      "A"
      (>= score 80)
      "B"
      (>= score 70)
      "C"
      (>= score 60)
      "D"
      :else "F")))
(map grade [95 82 75 63 45])
