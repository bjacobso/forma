(import "./preludes/kernel.forma" [cond and or not])
(export dispatch safe-divide)
(: dispatch (-> Bool Bool Int String))
(define dispatch [enabled urgent backlog]
 (cond (not enabled) "paused" (or urgent (>= backlog 20)) "express" (> backlog 0) "normal" :else "idle"))
(: safe-divide (-> Int Int Int))
(define safe-divide [n d] (if (and (not (= d 0)) (not (= (quot n d) 0))) (quot n d) 0))
