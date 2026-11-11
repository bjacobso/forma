(api Workshops
  (group booking
    (endpoint get-workshop :get "/workshops/:id"
      :params {:id WorkshopId} :success Workshop :errors [WorkshopNotFound])
    (endpoint reserve-seats :post "/reservations"
      :payload Reserve :success Workshop :errors [WorkshopNotFound NotEnoughSeats])))
(handle Workshops booking
  (handler get-workshop lookup)
  (handler reserve-seats reserve))
