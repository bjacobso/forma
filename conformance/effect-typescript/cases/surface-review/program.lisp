(type Shape (Tagged (Circle Int) None))
(type Other (Tagged (Circle String) Empty))
(type Role (Union :admin :member))
(type Roles (Map Role Int))
(type MaybeName (Option String))
(: roles Roles)
(define roles {:admin 1})
(: circle (Effect Shape))
(define circle (: (Shape.Circle 7) Shape))
(: other Other)
(define other (Other.Circle "x"))
(: missing (Option Int))
(define missing Option.None)
(: radius (-> Shape Int))
(define radius [shape] (match shape (Shape.Circle value) value Shape.None 0))
(service Counter (: next (Effect Int)))
(layer
  CounterLive
  :provides
  Counter
  :setup
  [cfg {:inner {:port 8}}]
  (define base [] 1)
  (define next (+ (base) cfg.inner.port)))
(error FirstError {})
(error SecondError {})
(: recover (-> Bool (Effect String)))
(define
  recover
  [first]
  (catch
    (if first (fail (FirstError {})) (fail (SecondError {})))
    (FirstError e)
    "first"
    err
    "fallback"))
(: handler-error (Effect String [SecondError]))
(define
  handler-error
  (catch
    (if true (fail (FirstError {})) (fail (SecondError {})))
    (FirstError e)
    (fail (SecondError {}))
    err
    "fallback"))
