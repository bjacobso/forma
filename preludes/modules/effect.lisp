; effect.lisp
; -----------------------------------------------------------------------------
; forma:effect: sequential Effect steps as a library (RFC 0029, stage 1).
;
; (do (bind x eff) (let y value) (bind _ eff2) result) runs each step in
; order. bind runs an effect and names its success value; _ discards the value
; but keeps the effect's errors and requirements. let names a pure value. A
; plain effect before the result runs and its value is discarded. The last
; form is the result. Every step expands to the engine's do!, so checking,
; diagnostics, and generated Effect TypeScript are do!'s.
;
; A do without bind or let steps keeps its core meaning: (do e1 e2) runs e1
; and returns e2, in an effect body or in a value.
; -----------------------------------------------------------------------------
(import "./kernel.lisp" [and or not])
(export do bind pure)

;; pure — an effect that succeeds with a value
;;
;; (pure {:total total})
(macro (pure value) `(succeed ~value))

;; bind — a step of do; it has no meaning on its own
(macro (bind parts ...)
  (syntax-error "effect/bind-outside-do"
    "bind is a step of do: write it as a direct child, as in (do (bind user (Users.find id)) (pure user))."))

;; do — run steps in order and return the last form
;;
;; (do (bind cart (Shop.find-cart id))
;;     (let total (sum (map (fn [item] (get item :price)) (get cart :items))))
;;     (bind _ (Mailer.send email (str total)))
;;     (pure total))
(macro (do forms ...)
  (let [bind-name (sexpr-sym-name `bind)
        head-of (fn [form] (if (sexpr-list? form) (sexpr-sym-name (first (sexpr-items form))) nil))
        let-step? (fn [form]
                    (and (= (head-of form) "let")
                         (= (count (sexpr-items form)) 3)
                         (not (= (sexpr-sym-name (nth (sexpr-items form) 1)) nil))))
        step? (fn [form] (or (= (head-of form) bind-name) (let-step? form)))]
    (if (= (count (filter step? forms)) 0)
      `(do ~@forms)
      (let [result (first (reverse forms))
            steps (reverse (rest (reverse forms)))
            pair (fn [form]
                   (if (= (head-of form) bind-name)
                     (let [items (sexpr-items form)]
                       (if (and (= (count items) 3) (not (= (sexpr-sym-name (nth items 1)) nil)))
                         [(nth items 1) (nth items 2)]
                         (syntax-error "effect/bind-shape"
                           "bind expects a name and an effect, as in (bind user (Users.find id))."
                           form)))
                     (if (let-step? form)
                       [:let [(nth (sexpr-items form) 1) (nth (sexpr-items form) 2)]]
                       ['_ form])))]
        (if (step? result)
          (syntax-error "effect/do-result"
            "do ends with a step; add a result after it, such as (pure value)."
            result)
          `(do! [~@(reduce (fn [acc form] (concat acc (pair form))) [] steps)] ~result))))))
