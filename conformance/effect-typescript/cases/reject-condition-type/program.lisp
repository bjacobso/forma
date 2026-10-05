;; Conditions must be Bool; Forma does not use JavaScript truthiness.
(: label (-> Int (Effect String [] [])))
(define-operation label [count]
  (if count
    (succeed "some")
    (succeed "none")))
