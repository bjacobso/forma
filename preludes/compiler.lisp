; Shared reflection and diagnostics helpers for form projections.
(define
  descriptor-construct
  [input]
  (construct/from-descriptor :input input :env (meta/semantic-env input)))

; Generic collection checks used by form validators.
(define
  diag/validate-membership-list
  [values allowed slot-key slot]
  (flat-map
    (fn
      [value]
      (if
        (contains? allowed value)
        []
        [(diag/error :slot slot :message (str "Unknown member: " value))]))
    values))
(define
  diag/validate-default-in-list
  [value values slot-key slot]
  (if
    (nil? value)
    []
    (if
      (contains? values value)
      []
      [(diag/error :slot slot :message (str "Default is not a member: " value))])))
