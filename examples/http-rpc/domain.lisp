(export WorkshopId Seats Reserve Workshop WorkshopNotFound NotEnoughSeats Booking lookup reserve)
; A workshop has twelve seats. A reservation claims 1–6 seats atomically.
(type WorkshopId (String :pattern "^ws-[a-z]+$"))
(type Seats (Int :min 1 :max 6))
(type Reserve {:id WorkshopId :seats Seats})
(type Workshop {:id WorkshopId :remaining Int})
(error WorkshopNotFound {:id WorkshopId} :status 404)
(error NotEnoughSeats {:id WorkshopId :requested Seats :remaining Int} :status 409)
(service Booking
  (: find (-> WorkshopId (Effect Workshop [WorkshopNotFound])))
  (: reserve (-> Reserve (Effect Workshop [WorkshopNotFound NotEnoughSeats]))))

(: lookup (-> {:params {:id WorkshopId}}
              (Effect Workshop [WorkshopNotFound] [Booking.find])))
(define lookup [request] (do! [workshop (Booking.find request.params.id)] workshop))
(: reserve (-> {:payload Reserve}
               (Effect Workshop [WorkshopNotFound NotEnoughSeats] [Booking.reserve])))
(define reserve [request] (do! [workshop (Booking.reserve request.payload)] workshop))
