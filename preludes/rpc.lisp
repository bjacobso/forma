; rpc.lisp
; Purpose: Unary Effect 4 RPC contracts, grouped for native handler registration.
; Requires: compiler.lisp. Consumers provide handlers and transport layers.

(type RpcIR
  {:kind "Rpc" :name String :payload Type :success Type :error (Option Type)})
(type RpcGroupIR {:kind "RpcGroup" :name Symbol :operations (List RpcIR)})

(form (rpc name {:keys [payload success error]})
  "Declares a unary RPC with request and success schemas and an optional error schema."
  :examples
    [[(rpc-group Greetings
        (rpc "Greet" :payload {:name String} :success String))]]
  :types {:name String :payload Type :success Type :error (Option Type)}
  :ir RpcIR
  :emit (fn [ir]
    `(Rpc.make ~(get ir :name)
       {:payload ~(ts/schema (get ir :payload))
        :success ~(ts/schema (get ir :success))
        :error ~(if (get ir :error) (ts/schema (get ir :error)) 'Schema.Never)}))
  {:kind "Rpc" :name name :payload payload :success success :error error})

(form (rpc-group name operation ...)
  "Groups RPC contracts with unique wire names. Native Effect supplies handlers and transport."
  :examples
    [[(type Greeting {:message String})
      (error Unavailable {:reason String})
      (rpc-group Greetings
        (rpc "Greet" :payload {:name String} :success Greeting :error Unavailable))]]
  :types {:name (Declares RpcGroupDecl) :operation (List rpc)}
  :ir RpcGroupIR
  :check (fn [{:keys [operation]}]
    (let [names (map (fn [op] op.name) operation)]
      (if (= (count names) (count (distinct names))) []
        [{:severity :error :code "rpc/duplicate-operation" :message "Duplicate RPC operation name"}])))
  :emit (fn [ir] `(RpcGroup.make ~@(ts/children (get ir :operations))))
  {:kind "RpcGroup" :name name :operations operation})
