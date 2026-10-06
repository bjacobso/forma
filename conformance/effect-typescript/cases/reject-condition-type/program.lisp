;; Conditions must be Bool; Forma does not use JavaScript truthiness.
(: label (-> Int (Effect String [] [])))
(define label [count]
  (if count
    (succeed "some")
    (succeed "none")))
