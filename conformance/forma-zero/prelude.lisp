; forma-zero prelude
; -----------------------------------------------------------------------------
; The portable Forma kernel described in docs/language.md, written in the shared
; Forma dialect so the same source runs on @formalang/ts (dynamic) and
; @formalang/ocaml (HM-typechecked).
;
; Representation — chosen to satisfy both engines:
;   fact      = a 3-vector of strings          ["ben" "works-for" "onboarded"]
;   pattern   = a 3-vector of strings; a slot is a VARIABLE iff it appears in
;               the query's explicit variable list (patterns stay homogeneous,
;               which the HM engine requires)
;   env       = a dynamic map of var-name -> value (see empty-env)
;   failure   = the empty collection; unify returns 0-or-1 envs (the option
;               monad as a 0/1-element collection — no failure-sentinel union)
;   log       = a list of facts, built with (lst ...)
;   proposal  = {:fact f :by "author"}
;   reaction  = (fn [fact log] -> facts to propose)
;
; Collection discipline: the HM engine types vector literals as Vector but
; pins polymorphic collection parameters to List, so facts/patterns (fixed
; 3-slot tuples, read only with nth) are vector literals, while every
; collection that flows through a function parameter is built with `lst`.
;
; The kernel is pure: `opeval` takes the log and proposals as values and
; returns the new log, so the suite needs no effects and no host bindings.
; -----------------------------------------------------------------------------

; --- helpers -----------------------------------------------------------------

; List construction: `(concat [...literal...] [])` is the portable way to
; build a List from a vector literal — the HM engine types vector literals as
; Vector but pins polymorphic collection parameters to List, and its `concat`
; always returns List. (A variadic helper would be nicer, but `&` rest params
; are untypeable on the HM engine.)

; the dynamic-map seed: assoc with a runtime string key makes the type a
; dynamic Map (not a fixed record) on the HM engine; runtime value is {}
(define empty-env (dissoc (assoc {} "x" "x") "x"))

(define member?
  (fn [xs x]
    (not (empty? (filter (fn [y] (= y x)) xs)))))

(define dedup
  (fn [xs]
    (reduce (fn [acc x] (if (member? acc x) acc (conj acc x)))
            (concat [] [])
            xs)))

; --- layer 1: the query algebra ----------------------------------------------

; extend env with v = x; returns 0-or-1 envs
(define bind
  (fn [v x env]
    (let [bound (get env v)]
      (cond
        (nil? bound) [(assoc env v x)]
        (= bound x) [env]
        :else []))))

; match one pattern slot against one fact slot
(define unify-slot
  (fn [vars p f env]
    (cond
      (member? vars p) (bind p f env)
      (= p f) [env]
      :else [])))

; unify a 3-slot pattern against a fact, threading the env through the slots
(define unify
  (fn [vars pat fact env]
    (flat-map (fn [env-b] (unify-slot vars (nth pat 2) (nth fact 2) env-b))
      (flat-map (fn [env-a] (unify-slot vars (nth pat 1) (nth fact 1) env-a))
        (unify-slot vars (nth pat 0) (nth fact 0) env)))))

; all extensions of env by pat over facts fs
(define matches
  (fn [vars pat fs env]
    (flat-map (fn [f] (unify vars pat f env)) fs)))

; conjunction: fold the env set through the patterns
; (no self-recursion anywhere in this kernel — every derivation is a fold,
; which is also the only shape both engines support: the HM engine's
; closures cannot see their own binding)
(define where*
  (fn [vars pats fs envs]
    (reduce (fn [es pat] (flat-map (fn [env] (matches vars pat fs env)) es))
            envs
            pats)))

(define where
  (fn [vars pats fs]
    (where* vars pats fs (concat [empty-env] []))))

; negation-as-absence
(define without
  (fn [vars pats neg fs]
    (filter (fn [env] (empty? (where* vars neg fs (concat [env] []))))
            (where vars pats fs))))

; --- layer 2: the derived "primitives" ----------------------------------------

; declaration: a fact is just a vector — nothing to define
; relation:    the attribute position (slot 1) — nothing to define

; constraint (obligation reading): subjects bound to v matching `when` but not `need`
(define violations
  (fn [vars when need v fs]
    (dedup (map (fn [env] (get env v)) (without vars when need fs)))))

; authority: a grant is a fact; the check is a query over the log
(define grant (fn [who what] [who "can" what]))

(define can?
  (fn [author fact fs]
    (not (empty? (where (concat [] []) (concat [[author "can" (nth fact 1)]] []) fs)))))

; action: a reaction gated on invocation facts  [who "invoke" name]
(define make-action
  (fn [name produce]
    (fn [f fs]
      (if (= (nth f 1) "invoke")
        (if (= (nth f 2) name) (produce f fs) (concat [] []))
        (concat [] [])))))

; constraint reconciler: emit [s "must" oblig] for each violation not yet obligated
(define make-obligate
  (fn [vars when need v oblig]
    (fn [f fs]
      (filter (fn [m] (not (member? fs m)))
              (map (fn [s] [s "must" oblig])
                   (violations vars when need v fs))))))

; --- layer 3: the generic workflow engine --------------------------------------

; the step graph is facts ([step "next" step]); one reaction advances on completion
(define advance
  (fn [f fs]
    (if (= (nth f 1) "completed")
      (map (fn [env] [(nth f 0) "now" (get env "n")])
           (where (concat ["n"] []) (concat [[(nth f 2) "next" "n"]] []) fs))
      (concat [] []))))

; --- layer 4: opeval — the admission loop --------------------------------------

(define emissions
  (fn [f fs reactions]
    (flat-map (fn [r] (r f fs)) reactions)))

; one round: fold the queued proposals into the log; reactions to facts
; admitted this round are queued for the next round
(define opeval-step
  (fn [reactions state]
    (reduce
      (fn [st p]
        (let [f (get p :fact)
              log (get st :log)]
          (cond
            (member? log f) st
            (not (can? (get p :by) f log)) st
            :else (let [logn (conj log f)
                        emitted (map (fn [e] {:fact e :by "system"})
                                     (emissions f logn reactions))]
                    {:log logn :queue (concat (get st :queue) emitted)}))))
      {:log (get state :log) :queue (concat [] [])}
      (get state :queue))))

; the admission loop as a fold over a bounded round counter — admission is
; idempotent (duplicates are skipped), so extra rounds are no-ops; a real
; substrate iterates to fixpoint, but a bounded fold keeps the kernel
; recursion-free
(define opeval
  (fn [log proposals reactions]
    (get (reduce (fn [st r] (opeval-step reactions st))
                 {:log log :queue proposals}
                 [1 2 3 4 5 6 7 8])
         :log)))
