;; Malformed effect forms are rejected at the form, not silently rewritten.
(define-error Missing (:fields (field id String)))

(: check (-> String (Effect String [Missing] [])))
(define-operation check [id]
  (if (= id "")
    (fail (Missing {:id id}))))
