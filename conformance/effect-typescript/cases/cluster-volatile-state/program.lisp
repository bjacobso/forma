; Deduplicated replies outlive in-memory state: after passivation, a retried
; Deposit would return its stored reply while the balance restarts at 0.
(entity Account
  :state {:balance Int}
  :initial {:balance 0}
  :storage :memory
  (command Deposit :payload {:key String :amount Int} :success Int
    :delivery :persisted :dedupe-by :key
    :update {:balance (+ state.balance amount)}
    :reply state.balance)
  (query Balance :success Int :reply state.balance))
