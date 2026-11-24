; Ordinary file-module macros. Tests stay dormant when this module is checked
; or imported. `forma test` selects one top-level test body per evaluation.
(export test is is=)

(define assertion-fail fail)

;; test — a named test; forma test runs its body
;;
;; (test "addition" (is= (+ 1 2) 3))
(macro (test name body ...) `(fn [] (do ~@body)))

;; is — assert that a condition is true
;;
;; (is (> 2 1))
(macro (is condition)
  `(if ~condition true (do (assertion-fail "expected true, actual false") true)))

;; is= — assert that two values are equal, reporting both when they differ
;;
;; (is= (+ 1 2) 3)
(macro (is= actual expected)
  (let [a (gensym "actual") e (gensym "expected")]
    `(let [~a ~actual ~e ~expected]
       (if (= ~a ~e) true
         (do (assertion-fail (str "expected " ~e ", actual " ~a)) true)))))
