;; Typed failure handling: recovering from several tags at once, from every
;; error, translating errors, falling back, and turning failures into
;; Option or Result values that are matched like any other data.
(error NotFound {:key String})
(error Forbidden {:user String})
(error RateLimited {:retry-after Int})
(error StorageError {:detail String})
(service
  Storage
  (:
    read
    (-> String String (Effect String [NotFound Forbidden RateLimited] []))))
(:
  read-or-explain
  (-> String String (Effect String [RateLimited] [Storage.read])))
(define
  read-or-explain
  [user key]
  (catch
    (Storage.read user key)
    (NotFound missing)
    (succeed (str "no " (get missing :key)))
    (Forbidden denied)
    (succeed (str (get denied :user) " may not read " key))))
(: read-anything (-> String String (Effect String [] [Storage.read])))
(define
  read-anything
  [user key]
  (catch
    (Storage.read user key)
    (_ error)
    (succeed (str "failed with " (get error :_tag)))))
(:
  read-wrapped
  (-> String String (Effect String [StorageError] [Storage.read])))
(define
  read-wrapped
  [user key]
  (map-error
    (Storage.read user key)
    (fn [error] (StorageError {:detail (str "read " key " failed")}))))
(: read-with-default (-> String String (Effect String [] [Storage.read])))
(define
  read-with-default
  [user key]
  (or-else-succeed (Storage.read user key) "default"))
(: read-option (-> String String (Effect (Option String) [] [Storage.read])))
(define read-option [user key] (option (Storage.read user key)))
(: describe-read (-> String String (Effect String [] [Storage.read])))
(define
  describe-read
  [user key]
  (do!
    [outcome (result (Storage.read user key))]
    (match
      outcome
      (Ok value)
      (succeed (str "ok: " value))
      (Err error)
      (succeed (str "error: " (get error :_tag))))))
(: read-or-die (-> String String (Effect String [] [Storage.read])))
(define read-or-die [user key] (or-die (Storage.read user key)))
