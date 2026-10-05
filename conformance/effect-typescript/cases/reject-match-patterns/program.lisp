;; Patterns must name real cases, bind only payloads, and stay reachable.
(define-schema Shape
  (TaggedUnion kind
    [circle (Struct (field radius Number))]
    [square (Struct (field side Number))]))

(: describe (-> Shape (Effect String [] [])))
(define-operation describe [shape]
  (match shape
    (circle c) (succeed "round")
    (triangle t) (succeed "pointy")
    _ (succeed "other")
    (square s) (succeed "boxy")))

(: maybe-name (-> (Option String) (Effect String [] [])))
(define-operation maybe-name [name]
  (match name
    (some n) (succeed n)
    (none missing) (succeed "anonymous")))

(define-schema Point (Struct (field x Int) (field y Int)))

(: quadrant (-> Point (Effect String [] [])))
(define-operation quadrant [point]
  (match point
    origin (succeed "origin")
    _ (succeed "elsewhere")))

(: parity (-> Int (Effect String [] [])))
(define-operation parity [n]
  (match n
    0 (succeed "zero")
    1 (succeed "one")))
