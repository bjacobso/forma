; One domain served three ways: an RPC group, an HTTP API, and a Cluster
; entity share schemas, errors, and the operation that implements lookup.
(type AccountId (Brand String))
(type Amount (Int :min 1 :max 1000))
(type Balance {:id AccountId :balance Int})
(type Deposit {:key String :amount Amount})
(error AccountNotFound {:id AccountId} :status 404)
(service Ledger (: find (-> AccountId (Effect Balance [AccountNotFound]))))

(: lookup (-> {:params {:id AccountId}} (Effect Balance [AccountNotFound] [Ledger.find])))
(define lookup [request] (do! [balance (Ledger.find request.params.id)] balance))

(rpc-group LedgerRpc
  (rpc "GetBalance" :payload {:id AccountId} :success Balance :error AccountNotFound))

(api Bank
  (group accounts
    (endpoint get-balance :get "/accounts/:id"
      :params {:id AccountId} :success Balance :errors [AccountNotFound])))
(handle Bank accounts (handler get-balance lookup))

(entity Account
  :state {:balance Int}
  :initial {:balance 0}
  :storage :memory
  :accept-state-loss true
  (command Deposit :payload Deposit :success Int
    :delivery :persisted :dedupe-by :key
    :update {:balance (+ state.balance amount)}
    :reply state.balance)
  (query Balance :success Int :reply state.balance))
