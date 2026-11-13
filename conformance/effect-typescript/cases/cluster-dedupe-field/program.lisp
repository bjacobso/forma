; Deduplication keys must be String or Int fields of the payload.
(type Transfer {:id String :amount Int})
(entity Account
  :state {:balance Int}
  :initial {:balance 0}
  :storage :memory
  :accept-state-loss true
  (command Deposit :payload Transfer :success Int
    :delivery :persisted :dedupe-by :request-id
    :update {:balance (+ state.balance amount)}
    :reply state.balance)
  (command Adjust :payload {:at Float :amount Int} :success Int
    :delivery :persisted :dedupe-by :at
    :update {:balance (+ state.balance amount)}
    :reply state.balance))
