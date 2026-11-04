; kernel.lisp
; -----------------------------------------------------------------------------
; Purpose: Core control-flow and threading macros, expanded before checking and evaluation.
; Requires: Core reader and macro evaluator; no descriptor preludes.
; Used by: Descriptor bootstrap and, via generated kernel.forma, explicit file-module imports.
; -----------------------------------------------------------------------------
;; not — logical negation
(macro (not x) `(if ~x false true))

;; when — conditional with implicit do
(macro (when test body ...) `(if ~test (do ~@body) nil))

;; unless — inverse conditional with implicit do
(macro (unless test body ...) `(if ~test nil (do ~@body)))

;; cond — multi-branch conditional
;;
;; (cond
;;   (> x 0)  "positive"
;;   (< x 0)  "negative"
;;   :else    "zero")
;;
(macro (cond clauses ...)
  (if (empty? clauses)
    nil
    (let [test         (first clauses)
          expr         (nth clauses 1)
          rest-clauses (rest (rest clauses))]
      (if (= (sexpr-sym-name test) ":else")
        expr
        (if (empty? rest-clauses)
          `(if ~test ~expr nil)
          `(if ~test ~expr (cond ~@rest-clauses)))))))

;; and — short-circuit logical AND
;;
;; (and x y z) expands to nested let/if that stops on first falsy value
;;
(macro (and args ...)
  (if (empty? args)
    true
    (if (= (count args) 1)
      (first args)
      (let [g (gensym "and")]
        `(let [~g ~(first args)] (if ~g (and ~@(rest args)) ~g))))))

;; or — short-circuit logical OR
;;
;; (or x y z) expands to nested let/if that stops on first truthy value
;;
(macro (or args ...)
  (if (empty? args)
    nil
    (if (= (count args) 1)
      (first args)
      (let [g (gensym "or")]
        `(let [~g ~(first args)] (if ~g ~g (or ~@(rest args))))))))

;; -> — thread-first
;;
;; (-> x (f a) (g b)) expands to (g (f x a) b)
;;
(macro (-> x forms ...)
  (if (empty? forms)
    x
    (let [form       (first forms)
          rest-forms (rest forms)
          threaded
            (if (sexpr-list? form)
              (let [items     (sexpr-items form)
                    head      (first items)
                    rest-args (rest items)]
                `(~head ~x ~@rest-args))
              `(~form ~x))]
      (if (empty? rest-forms) threaded `(-> ~threaded ~@rest-forms)))))

;; ->> — thread-last
;;
;; (->> x (f a) (g b)) expands to (g b (f a x))
;;
(macro (->> x forms ...)
  (if (empty? forms)
    x
    (let [form       (first forms)
          rest-forms (rest forms)
          threaded
            (if (sexpr-list? form)
              (let [items (sexpr-items form)] `(~@items ~x))
              `(~form ~x))]
      (if (empty? rest-forms) threaded `(->> ~threaded ~@rest-forms)))))
