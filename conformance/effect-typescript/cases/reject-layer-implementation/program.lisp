;; A layer must implement every method with the service's declared types.
(define-error Unavailable (:fields (field reason String)))
(define-error Corrupt (:fields (field key String)))

(define-service Cache
  (:methods
    (read [key String] (Effect (Option String) [Unavailable] []))
    (write [key String value String] (Effect Unit [Unavailable] []))))

(define-layer CacheBroken
  (:provides Cache)
  (:methods
    (read [key]
      (if (= key "")
        (fail (Corrupt {:key key}))
        (succeed none)))))
