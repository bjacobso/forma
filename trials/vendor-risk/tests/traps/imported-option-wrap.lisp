(import "./t.lisp" [T])
(: x T)
(define x {:a 1 :b 2})
(: y T)
(define y {:a 1})
[x.b y.b]
