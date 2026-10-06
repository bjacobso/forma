;; Releasing a resource must not fail; Effect would turn it into a defect.
(error CloseFailed {:handle String})

(service Files
  (: open (-> String (Effect String [] [])))
  (: close (-> String (Effect Unit [CloseFailed] []))))

(: with-file (-> String (Effect String [] [Files Scope])))
(define with-file [path]
  (acquire-release (Files.open path)
    (fn [handle] (Files.close handle))))
