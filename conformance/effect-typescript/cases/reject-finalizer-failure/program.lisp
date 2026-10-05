;; Releasing a resource must not fail; Effect would turn it into a defect.
(define-error CloseFailed (:fields (field handle String)))

(define-service Files
  (:methods
    (open [path String] (Effect String [] []))
    (close [handle String] (Effect Unit [CloseFailed] []))))

(: with-file (-> String (Effect String [] [Files Scope])))
(define-operation with-file [path]
  (acquire-release (Files.open path)
    (fn [handle] (Files.close handle))))
