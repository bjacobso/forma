(export pair PairIR)
(type PairIR {:kind "Pair"})
(form (pair left right)
  :types {:left (Declares Entry) :right (Declares Entry)}
  :ir PairIR
  {:kind "Pair"})
(pair first-entry second-entry)
[first-entry second-entry]
