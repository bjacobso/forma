;; A user directory: branded ids, an enum, tagged errors, a repository
;; service with a Forma-implemented in-memory layer, and CRUD operations.
;; The harness supplies the id generator.

(define-schema UserId (Brand UserId String))

(define-schema Role (Enum admin member))

(define-schema User
  (Struct
    (field id UserId)
    (field name String)
    (field email String)
    (field role Role)
    (field nickname (Optional String))))

(define-schema NewUser
  (Struct
    (field name String)
    (field email String)
    (field role Role)))

(define-error UserNotFound (:fields (field id UserId)))
(define-error DuplicateEmail (:fields (field email String)))
(define-error InvalidUser (:fields (field reason String)))

(define-service UserRepo
  (:methods
    (find [id UserId] (Effect (Option User) [] []))
    (find-by-email [email String] (Effect (Option User) [] []))
    (save [user User] (Effect Unit [] []))
    (remove [id UserId] (Effect Bool [] []))
    (all [] (Effect (Array User) [] []))))

(define-service Ids
  (:methods
    (next [] (Effect UserId [] []))))

(: display-name (-> User String))
(define display-name
  (fn [user]
    (str (get-or-else (get user :nickname) (get user :name)) " <" (get user :email) ">")))

(: validate (-> NewUser (Effect NewUser [InvalidUser] [])))
(define-operation validate [input]
  (cond
    (= (trim (get input :name)) "") (fail (InvalidUser {:reason "name is required"}))
    (not (includes? (get input :email) "@")) (fail (InvalidUser {:reason "email is invalid"}))
    :else (succeed input)))

(: create-user (-> NewUser (Effect User [InvalidUser DuplicateEmail] [UserRepo Ids])))
(define-operation create-user [input]
  (do! [valid (validate input)
        existing (UserRepo.find-by-email (get valid :email))]
    (match existing
      (some _) (fail (DuplicateEmail {:email (get valid :email)}))
      none (do! [id (Ids.next)
                 user (succeed {:id id
                                :name (get valid :name)
                                :email (get valid :email)
                                :role (get valid :role)})
                 _ (UserRepo.save user)]
             (succeed user)))))

(: get-user (-> UserId (Effect User [UserNotFound] [UserRepo.find])))
(define-operation get-user [id]
  (do! [found (UserRepo.find id)]
    (match found
      (some user) (succeed user)
      none (fail (UserNotFound {:id id})))))

(: rename-user (-> UserId String (Effect User [UserNotFound InvalidUser] [UserRepo.find UserRepo.save])))
(define-operation rename-user [id name]
  (do! [user (get-user id)]
    (if (= (trim name) "")
      (fail (InvalidUser {:reason "name is required"}))
      (do! [renamed (succeed (assoc user :name name))
            _ (UserRepo.save renamed)]
        (succeed renamed)))))

(: delete-user (-> UserId (Effect Unit [UserNotFound] [UserRepo.remove])))
(define-operation delete-user [id]
  (do! [removed (UserRepo.remove id)]
    (unless removed
      (fail (UserNotFound {:id id})))))

(: admin-names (-> (Effect (Array String) [] [UserRepo.all])))
(define-operation admin-names []
  (do! [users (UserRepo.all)]
    (succeed (map display-name (filter (fn [user] (= (get user :role) "admin")) users)))))

(: find-or-default (-> UserId String (Effect String [] [UserRepo.find])))
(define-operation find-or-default [id fallback]
  (catch (do! [user (get-user id)] (succeed (get user :name)))
    (UserNotFound _) (succeed fallback)))

(define-layer UserRepoMemory
  (:provides UserRepo)
  (:setup [store (ref-make (: {} (Map User)))])
  (:methods
    (find [id]
      (do! [users (ref-get store)]
        (succeed (get users id))))
    (find-by-email [email]
      (do! [users (ref-get store)]
        (succeed (find (fn [user] (= (get user :email) email)) (vals users)))))
    (save [user]
      (ref-update store (fn [users] (assoc users (get user :id) user))))
    (remove [id]
      (do! [users (ref-get store)
            _ (ref-set store (dissoc users id))]
        (succeed (has-key? users id))))
    (all []
      (do! [users (ref-get store)]
        (succeed (vals users))))))
