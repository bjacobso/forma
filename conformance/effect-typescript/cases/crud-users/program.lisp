;; A user directory: branded ids, an enum, tagged errors, a repository
;; service with a Forma-implemented in-memory layer, and CRUD operations.
;; The harness supplies the id generator.

(type UserId (Brand String))

(type Role (Union :admin :member))

(type User {:id UserId
 :name String
 :email String
 :role Role
 :nickname (Option String)})

(type NewUser {:name String
 :email String
 :role Role})

(error UserNotFound {:id UserId})
(error DuplicateEmail {:email String})
(error InvalidUser {:reason String})

(service UserRepo
  (: find (-> UserId (Effect (Option User) [] [])))
  (: find-by-email (-> String (Effect (Option User) [] [])))
  (: save (-> User (Effect Unit [] [])))
  (: remove (-> UserId (Effect Bool [] [])))
  (: all (Effect (List User) [] [])))

(service Ids
  (: next (Effect UserId [] [])))

(: display-name (-> User String))
(define display-name
   [user]
    (str (get-or-else (get user :nickname) (get user :name)) " <" (get user :email) ">"))

(: validate (-> NewUser (Effect NewUser [InvalidUser] [])))
(define validate [input]
  (cond
    (= (trim (get input :name)) "") (fail (InvalidUser {:reason "name is required"}))
    (not (includes? (get input :email) "@")) (fail (InvalidUser {:reason "email is invalid"}))
    :else (succeed input)))

(: create-user (-> NewUser (Effect User [InvalidUser DuplicateEmail] [UserRepo Ids])))
(define create-user [input]
  (do! [valid (validate input)
        existing (UserRepo.find-by-email (get valid :email))]
    (match existing
      (Some _) (fail (DuplicateEmail {:email (get valid :email)}))
      None (do! [id Ids.next
                 user (succeed {:id id
                                :name (get valid :name)
                                :email (get valid :email)
                                :role (get valid :role)})
                 _ (UserRepo.save user)]
             (succeed user)))))

(: get-user (-> UserId (Effect User [UserNotFound] [UserRepo.find])))
(define get-user [id]
  (do! [found (UserRepo.find id)]
    (match found
      (Some user) (succeed user)
      None (fail (UserNotFound {:id id})))))

(: rename-user (-> UserId String (Effect User [UserNotFound InvalidUser] [UserRepo.find UserRepo.save])))
(define rename-user [id name]
  (do! [user (get-user id)]
    (if (= (trim name) "")
      (fail (InvalidUser {:reason "name is required"}))
      (do! [renamed (succeed (assoc user :name name))
            _ (UserRepo.save renamed)]
        (succeed renamed)))))

(: delete-user (-> UserId (Effect Unit [UserNotFound] [UserRepo.remove])))
(define delete-user [id]
  (do! [removed (UserRepo.remove id)]
    (unless removed
      (fail (UserNotFound {:id id})))))

(: admin-names (Effect (List String) [] [UserRepo.all]))
(define admin-names (do! [users UserRepo.all]
    (succeed (map display-name (filter (fn [user] (= (get user :role) "admin")) users)))))

(: find-or-default (-> UserId String (Effect String [] [UserRepo.find])))
(define find-or-default [id fallback]
  (catch (do! [user (get-user id)] (succeed (get user :name)))
    (UserNotFound _) (succeed fallback)))

(layer UserRepoMemory :provides UserRepo
  :setup [store (ref-make (: {} (Map String User)))]
  (define find [id] (do! [users (ref-get store)]
        (succeed (get users id))))
  (define find-by-email [email] (do! [users (ref-get store)]
        (succeed (find (fn [user] (= (get user :email) email)) (vals users)))))
  (define save [user] (ref-update store (fn [users] (assoc users (get user :id) user))))
  (define remove [id] (do! [users (ref-get store)
            _ (ref-set store (dissoc users id))]
        (succeed (has-key? users id))))
  (define all [] (do! [users (ref-get store)]
        (succeed (vals users)))))
