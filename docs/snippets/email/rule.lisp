; warm-up email 3: who gets it, when, and how fast
(rule "launch-warmup-3"
  (lanes
    (lane "gmail"   :per-hour 2000)
    (lane "default" :per-hour 16000))
  (when (due? "value-path" 6h) (defer 6h))
  (when (tag? "customer") (skip "already bought"))
  (when (domain? "gmail.com") (send "gmail"))
  (send "default"))
