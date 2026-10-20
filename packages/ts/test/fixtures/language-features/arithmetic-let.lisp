(let
  [
    rate
    150
    hours
    40
    revenue
    (* rate hours)
    cost
    4000
    margin
    (- revenue cost)
    margin-pct
    (/ margin revenue)]
  {
    :revenue revenue
    :cost cost
    :margin margin
    :margin-pct (round (* margin-pct 100))})
