; kernel.lisp
; -----------------------------------------------------------------------------
; Purpose: Core control-flow and threading macros, expanded before checking and evaluation.
; Requires: Core reader and macro evaluator; no descriptor preludes.
; Used by: Descriptor bootstrap and, via generated modules/kernel.lisp, explicit file-module imports.
; -----------------------------------------------------------------------------
;; not — logical negation
;;
;; (not (> 1 2))
(macro (not x) `(if ~x false true))

;; when — conditional with implicit do
;;
;; (when (> 2 1) "bigger")
(macro (when test body ...) `(if ~test (do ~@body) nil))

;; unless — inverse conditional with implicit do
;;
;; (unless (> 1 2) "not bigger")
(macro (unless test body ...) `(if ~test nil (do ~@body)))

;; cond — multi-branch conditional
;;
;; (cond
;;   (> 5 0)  "positive"
;;   (< 5 0)  "negative"
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
;; Expands to nested let/if that stops on the first falsy value.
;;
;; (and (> 2 1) (< 2 3))
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
;; Expands to nested let/if that stops on the first truthy value.
;;
;; (or (> 1 2) (< 1 2))
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
;; Threads x into the first argument: x (f a) (g b) becomes (g (f x a) b).
;;
;; (-> 5 (- 1) (* 2))
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
;; Threads x into the last argument: x (f a) (g b) becomes (g b (f a x)).
;;
;; (->> [1 2 3] (map (fn [x] (* x 2))) (filter (fn [x] (> x 2))))
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
