;; A layer must implement every method with the service's declared types.
(error Unavailable {:reason String})
(error Corrupt {:key String})

(service Cache
  (: read (-> String (Effect (Option String) [Unavailable] [])))
  (: write (-> String String (Effect Unit [Unavailable] []))))

(layer CacheBroken :provides Cache
  (define read [key] (if (= key "")
        (fail (Corrupt {:key key}))
        (succeed None))))
