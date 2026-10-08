; Prelude forms, closed handler errors, path decoding, payloads and two groups.
(type UserId (Brand String))
(type User {:id UserId :name String})
(error UserNotFound {:id UserId} :status 404)
(service UserRepo (: find (-> UserId (Effect User [UserNotFound]))))

(: lookup (-> {:params {:id UserId}} (Effect User [UserNotFound] [UserRepo.find])))
(define lookup [request] (do! [user (UserRepo.find request.params.id)] user))
(: create-user (-> {:payload User} (Effect User)))
(define create-user [request] request.payload)
(: health (-> {} (Effect String)))
(define health [request] "ok")

(api Shop
  (group users
    (endpoint get-user :get "/users/:id"
      :params {:id UserId} :success User :errors [UserNotFound])
    (endpoint create-user :post "/users" :payload User :success User))
  (group system
    (endpoint health :get "/health" :success String)))
(handle Shop users (handler get-user lookup) (handler create-user create-user))
(handle Shop system (handler health health))
