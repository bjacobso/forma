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
;
; service, error, class, layer, and catch (stages 2-3) are in scope in every
; Effect program without an import. They lower declarations to the engine's
; __service, __error, __class, and __layer, and normalize catch shorthand.
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

;; service — a service of methods and values, in every Effect program
;;
;; (service Users
;;   (: find (-> UserId (Effect User [UserNotFound])))
;;   (: count (Effect Int)))
;;
;; A member whose type is (-> P ... R) is a method with parameters arg0,
;; arg1, ...; a member of any other type is a service value, written (name R).
(macro (service parts ...)
  (if (= (count parts) 0)
    `(service)
    (let [member (fn [m]
                   (let [items (if (sexpr-list? m) (sexpr-items m) [])]
                     (if (and (= (count items) 3) (= (sexpr-sym-name (first items)) ":"))
                       (let [n (nth items 1)
                             t (nth items 2)
                             ts (if (sexpr-list? t) (sexpr-items t) [])]
                         (if (and (> (count ts) 0) (= (sexpr-sym-name (first ts)) "->"))
                           (let [params (reverse (rest (reverse (rest ts))))
                                 named (reduce (fn [acc p] [(concat (first acc) [(sym (str "arg" (nth acc 1))) p]) (+ (nth acc 1) 1)])
                                               [[] 0] params)]
                             `(~n [~@(first named)] ~(first (reverse ts))))
                           `(~n ~t)))
                       (syntax-error "surface/invalid-form" "service members require (: name Type)" m))))]
      `(__service ~(first parts) (:methods ~@(map member (rest parts)))))))

;; error — a tagged error type, in every Effect program
;;
;; (error UserNotFound {:id UserId})
(macro (error parts ...) `(__error ~@parts))

;; class — a nominal class type, in every Effect program
;;
;; (class Customer {:name String})
(macro (class parts ...) `(__class ~@parts))

;; layer — a service implementation or layer composition, in every Effect program
;;
;; (layer AppLive (layer-provide A (layer-merge B C)))
;; (layer UsersLive :provides Users :setup [db (open-db)] (define find [id] ...))
(macro (layer parts ...)
  (if (= (count parts) 0)
    (syntax-error "surface/invalid-form"
      "layer requires a name and either a layer expression or :provides Service")
    (let [layer-name (first parts)
          layer-sym (sexpr-sym-name layer-name)
          body (rest parts)
          kw? (fn [x] (let [n (sexpr-sym-name x)] (and (not (= n nil)) (starts-with? n ":"))))
          head-of (fn [x]
                    (if (and (sexpr-list? x) (not (sexpr-vector? x)) (> (count (sexpr-items x)) 0))
                      (sexpr-sym-name (first (sexpr-items x)))
                      nil))]
      (if (or (= layer-sym nil) (starts-with? layer-sym ":"))
        (syntax-error "surface/invalid-form" "layer requires a symbolic name" layer-name)
        (if (= (count body) 0)
          (syntax-error "surface/invalid-form"
            "layer requires either a layer expression or :provides Service")
          (if (and (= (count body) 1)
                   (not (kw? (first body)))
                   (not (= (head-of (first body)) "define"))
                   (not (and (not (= (head-of (first body)) nil)) (starts-with? (head-of (first body)) ":"))))
            `(__layer ~layer-name ~(first body))
            (let [step (fn [state item]
                         (let [pending (nth state 0)
                               sections (nth state 1)
                               methods (nth state 2)]
                           (if (not (= pending nil))
                             [nil (concat sections [`(~pending ~item)]) methods]
                             (if (kw? item)
                               [item sections methods]
                               (if (= (head-of item) "define")
                                 (let [items (sexpr-items item)]
                                   (if (and (>= (count items) 3)
                                            (let [mn (sexpr-sym-name (nth items 1))]
                                              (and (not (= mn nil)) (not (starts-with? mn ":")))))
                                     [nil sections (concat methods [`(~(nth items 1) ~@(rest (rest items)))])]
                                     (syntax-error "surface/invalid-form"
                                       "layer methods require (define name [params...] body)" item)))
                                 (if (and (not (= (head-of item) nil)) (starts-with? (head-of item) ":"))
                                   [nil (concat sections [item]) methods]
                                   (syntax-error "surface/invalid-form"
                                     "layer expects :provides, :setup, or (define name [params...] body)" item)))))))
                  done (reduce step [nil [] []] body)
                  dangling (nth done 0)
                  sections (nth done 1)
                  methods (nth done 2)]
              (if (not (= dangling nil))
                (syntax-error "surface/invalid-form"
                  (str "layer section " (sexpr-sym-name dangling) " requires a value") dangling)
                `(__layer ~layer-name ~@sections (:methods ~@methods))))))))))

;; catch — recover from tagged errors or all typed errors, in every Effect program
;;
;; (catch eff (NotFound e) handler)
;; (catch eff (A a) h1 (B b) h2)
;; (catch eff err handler)
(macro (catch parts ...)
  (let [n (count parts)
        clauses (if (> n 0) (rest parts) [])]
    (if (or (< n 3) (not (= (mod (count clauses) 2) 0)))
      (syntax-error "artifact/effect-body"
        "catch expects an effect followed by (ErrorType binding) handler pairs.")
      (let [lower-start? (fn [s]
                           (let [chars (split s "")]
                             (and (> (count chars) 0)
                                  (let [c (first chars)]
                                    (or (= c "_") (and (= c (lower c)) (not (= c (upper c)))))))))
            norm-pattern (fn [pat]
                           (let [pn (sexpr-sym-name pat)]
                             (if (not (= pn nil))
                               (if (lower-start? pn)
                                 `(_ ~pat)
                                 (syntax-error "artifact/effect-body"
                                   "catch patterns must be (ErrorType binding) or (_ binding)." pat))
                               (if (and (sexpr-list? pat) (not (sexpr-vector? pat)) (= (count (sexpr-items pat)) 2)
                                        (not (= (sexpr-sym-name (first (sexpr-items pat))) nil))
                                        (not (= (sexpr-sym-name (nth (sexpr-items pat) 1)) nil)))
                                 pat
                                 (syntax-error "artifact/effect-body"
                                   "catch patterns must be (ErrorType binding) or (_ binding)." pat)))))
            step (fn [state item]
                   (let [is-pat (nth state 0)
                         out (nth state 1)]
                     (if is-pat
                       [false (concat out [(norm-pattern item)])]
                       [true (concat out [item])])))
            normalized (nth (reduce step [true []] clauses) 1)]
        `(catch ~(first parts) ~@normalized)))))
