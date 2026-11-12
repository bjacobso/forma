(export message)
(: message (-> Int String))
(define message [n] (if (> n 250000) "finance" (if (> n 7500) "manager" "auto")))
