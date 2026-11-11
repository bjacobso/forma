(type ApprovalRole (Union "manager" "finance"))
(: required (-> Int (List ApprovalRole)))
(define required [n] (if (> n 100) ["manager" "finance"] ["manager"]))
(: is (-> String a a Bool))
(define is [label actual expected] (= actual expected))
[(is "two roles" (required 500) ["manager" "finance"])
 (is "reversed" ["manager"] (required 1))]
