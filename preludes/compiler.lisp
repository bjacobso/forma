; compiler.lisp
; -----------------------------------------------------------------------------
; Purpose: Shared reflection and diagnostic helpers for form projections.
; Requires: Core builtins and kernel macros (provided by descriptor bootstrap).
; Used by: Domain prelude validators and projections.
; -----------------------------------------------------------------------------
(define descriptor-construct [input]
  (construct/from-descriptor :input input :env (meta/semantic-env input)))

; Generic collection checks used by form validators.
(define diag/validate-membership-list [values allowed slot-key slot]
  (flat-map
    (fn [value]
      (if (contains? allowed value)
        []
        [(diag/error :slot slot :message (str "Unknown member: " value))]))
    values))

(define diag/validate-default-in-list [value values slot-key slot]
  (if (nil? value)
    []
    (if (contains? values value)
      []
      [(diag/error :slot slot :message (str "Default is not a member: " value))])))

; Build a string-keyed map from distinct binding names, retaining value syntax.
; (named-map gap visible) expands to {"gap" gap "visible" visible}.
(macro (named-map names ...)
  (reduce
    (fn [result name]
      (let [key (sexpr-sym-name name)]
        (if (nil? key)
          (fail "named-map expects identifier symbols")
          (if (or (starts-with? key ":") (= key "nil"))
            (fail "named-map expects identifier symbols")
            (if (contains? result key)
              (fail "named-map expects distinct names")
              (assoc result key name))))))
    {}
    names))
