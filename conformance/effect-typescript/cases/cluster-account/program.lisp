; An Effect Cluster entity with persisted, deduplicated commands.
(type Amount (Int :min 1 :max 1000))
(type Deposit {:key String :amount Amount})
(error InsufficientFunds {:balance Int :requested Amount})

(entity Account
  :state {:balance Int}
  :initial {:balance 0}
  :storage :memory
  :accept-state-loss true
  :max-idle "5 minutes"

  (command Deposit :payload Deposit :success Int
    :delivery :persisted :dedupe-by :key
    :update {:balance (+ state.balance amount)}
    :reply state.balance)

  (command Withdraw :payload {:key String :amount Amount}
    :success Int :error InsufficientFunds
    :delivery :persisted :dedupe-by :key
    :guard (<= amount state.balance)
    :reject (InsufficientFunds {:balance state.balance :requested amount})
    :update {:balance (- state.balance amount)}
    :reply state.balance)

  (query Balance :success Int :reply state.balance))
