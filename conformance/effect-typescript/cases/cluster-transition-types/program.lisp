; Transitions are checked like any Effect function: state shape, reply type,
; and the closed error set.
(error InsufficientFunds {:balance Int})
(error Frozen {:reason String})
(entity Account
  :state {:balance Int}
  :initial {:balance 0}
  :storage :memory
  (command Withdraw :payload {:amount Int} :success Int :error InsufficientFunds
    :delivery :volatile
    :guard (<= amount state.balance)
    :reject (Frozen {:reason "closed"})
    :update {:balance (- state.balance amount) :limit 0}
    :reply (str state.balance)))
