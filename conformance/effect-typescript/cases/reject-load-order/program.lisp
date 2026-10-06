;; A constant that needs itself while the module loads (here through a
;; function) is rejected, as is a _ arm after every case is matched.
(: base Int)
(define base (bump 1))

(: bump (-> Int Int))
(define bump  [n] (+ n base))

(: describe (-> Bool String))
(define describe  [flag] (match flag true "on" false "off" _ "unknown"))
