;; Patterns must name real cases, bind only payloads, and stay reachable.
(type Shape (Tagged :tag kind (Circle {:radius Number}) (Square {:side Number})))

(: describe (-> Shape (Effect String [] [])))
(define describe [shape]
  (match shape
    (Circle c) (succeed "round")
    (triangle t) (succeed "pointy")
    _ (succeed "other")
    (Square s) (succeed "boxy")))

(: maybe-name (-> (Option String) (Effect String [] [])))
(define maybe-name [name]
  (match name
    (Some n) (succeed n)
    (None missing) (succeed "anonymous")))

(type Point {:x Int
 :y Int})

(: quadrant (-> Point (Effect String [] [])))
(define quadrant [point]
  (match point
    origin (succeed "origin")
    _ (succeed "elsewhere")))

(: parity (-> Int (Effect String [] [])))
(define parity [n]
  (match n
    0 (succeed "zero")
    1 (succeed "one")))
