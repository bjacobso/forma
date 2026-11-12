(export marker MarkerIR)
(type MarkerIR {:message String})
(form (marker message)
  :types {:message String}
  :ir MarkerIR
  {:message message})
(marker "projected")
