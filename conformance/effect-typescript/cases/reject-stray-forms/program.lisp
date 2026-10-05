;; Top-level forms an Effect program cannot use are reported rather than
;; silently dropped.
(define helper (fn [x] (+ x 1)))

(define-servce Mailer (:methods (send [to String] (Effect Unit [] []))))

(+ 1 2)

(: orphan (-> Int Int))
