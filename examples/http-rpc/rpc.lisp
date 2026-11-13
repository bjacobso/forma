(import "./domain.lisp" [WorkshopId Reserve Workshop WorkshopNotFound NotEnoughSeats])
(import "forma:effect/rpc" [rpc-group rpc])
(export WorkshopRpc)

(rpc-group WorkshopRpc
  (rpc "GetWorkshop" :payload {:id WorkshopId} :success Workshop :error WorkshopNotFound)
  (rpc "ReserveSeats" :payload Reserve :success Workshop
    :error (Union WorkshopNotFound NotEnoughSeats)))
