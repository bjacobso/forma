; Vendored from preludes/modules/test.lisp so this example is self-contained.
; Ordinary file-module macros. Tests stay dormant when this module is checked
; or imported. `forma test` selects one top-level test body per evaluation.
(export test is is=)

(define assertion-fail fail)

(macro (test name body ...) `(fn [] (do ~@body)))

(macro (is condition)
  `(if ~condition true (do (assertion-fail "expected true, actual false") true)))

(macro (is= actual expected)
  (let [a (gensym "actual") e (gensym "expected")]
    `(let [~a ~actual ~e ~expected]
       (if (= ~a ~e) true
         (do (assertion-fail (str "expected " ~e ", actual " ~a)) true)))))
