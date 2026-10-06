;; Malformed effect forms are rejected at the form, not silently rewritten.
(error Missing {:id String})

(: check (-> String (Effect String [Missing] [])))
(define check [id]
  (if (= id "")
    (fail (Missing {:id id}))))
