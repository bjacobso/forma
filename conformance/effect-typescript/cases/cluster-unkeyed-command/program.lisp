; A persisted command that changes state without a deduplication key.
(entity Account
  :state {:balance Int}
  :initial {:balance 0}
  :storage :memory
  :accept-state-loss true
  (command Deposit :payload {:key String :amount Int} :success Int
    :delivery :persisted
    :update {:balance (+ state.balance amount)}
    :reply state.balance))
