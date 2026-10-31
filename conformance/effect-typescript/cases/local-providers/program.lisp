;; Local providers: (provide effect (implement Service ...)) supplies a service
;; where it is used. Methods close over local values, and :delegate forwards the
;; members it does not define to the outer implementation.
(error NotFound {:key String})
(service Store
  (: get (-> String (Effect String [NotFound] [])))
  (: set (-> String String (Effect Unit [] []))))
(service Audit (: record (-> String (Effect Unit [] []))))
(: save-user (-> String (Effect String [NotFound] [Store])))
(define save-user [name] (do (Store.set "user" name) (Store.get "user")))
(: audited (-> String (Effect Unit [] [Audit.record])))
(define audited [entry] (Audit.record entry))
(: recorded-writes (-> String (Effect (List String) [NotFound] [])))
(define
  recorded-writes
  [name]
  (do!
    [writes
     (ref-make (: [] (List String)))
     _
     (provide
       (save-user name)
       (implement
         Store
         (define get [key] (succeed name))
         (define set [key value] (ref-update writes (fn [xs] (conj xs value))))))]
    (ref-get writes)))
(: layered (-> String (Effect (List String) [NotFound] [])))
(define
  layered
  [fallback]
  (provide
    (do!
      [outer
       (Store.get "a")
       inner
       (provide
         (Store.get "b")
         (implement
           Store
           (define get [key] (succeed (str "inner " key)))
           (define set [key value] (succeed nil))))]
      [outer inner])
    (implement
      Store
      (define get [key] (succeed (str fallback " " key)))
      (define set [key value] (succeed nil)))))
(: lookup (-> String (Effect String [] [])))
(define
  lookup
  [key]
  (catch
    (provide
      (Store.get key)
      (implement
        Store
        (define get [missing] (fail (NotFound {:key missing})))
        (define set [k v] (succeed nil))))
    (NotFound error)
    (succeed (str "missing " error.key))))
(: forward-reads (-> String (Effect String [NotFound] [Store.get Audit.record])))
(define
  forward-reads
  [name]
  (provide
    (save-user name)
    (implement Store :delegate (define set [key value] (Audit.record (str key "=" value))))))
(: audited-writes (-> String (Effect String [NotFound] [Audit.record])))
(define
  audited-writes
  [name]
  (provide
    (save-user name)
    (implement
      Store
      (define get [key] (succeed name))
      (define set [key value] (audited (str "audited " key "=" value))))))
(: stacked (-> String (Effect (List String) [NotFound] [])))
(define
  stacked
  [name]
  (do!
    [entries
     (ref-make (: [] (List String)))
     _
     (provide
       (save-user name)
       (implement
         Store
         (define get [key] (succeed name))
         (define set [key value] (Audit.record (str key "=" value))))
       (implement Audit (define record [entry] (ref-update entries (fn [xs] (conj xs entry))))))]
    (ref-get entries)))
