; cluster.lisp
; -----------------------------------------------------------------------------
; Purpose: Effect 4 Cluster entities: message protocols, delivery rules, and
;          pure state transitions.
; Requires: compiler.lisp; the cluster linker checks each transition as an
;           ordinary Effect function.
; Used by: The optional TypeScript cluster linker. Runners, message storage,
;          and process wiring belong to hosts.
; -----------------------------------------------------------------------------

(type ClusterCommandIR
  {:kind "ClusterCommand" :name Symbol :payload (Option Type) :success Type
   :error (Option Type) :delivery Keyword :dedupe-by (Option Keyword)
   :guard (Option RuntimeExpr) :reject (Option RuntimeExpr)
   :update (Option RuntimeExpr) :reply RuntimeExpr :handler (Option String)})
(type ClusterQueryIR
  {:kind "ClusterQuery" :name Symbol :payload (Option Type) :success Type
   :reply RuntimeExpr :handler (Option String)})
(type message (Union ClusterCommandIR ClusterQueryIR))
(type ClusterEntityIR
  {:kind "ClusterEntity" :name Symbol :state Type :initial RuntimeExpr
   :storage Keyword :accept-state-loss (Option Bool) :max-idle (Option String)
   :state-type String :initial-name String :messages (List message)})

; Target names: (cluster-lower-first "OrderBook") is "orderBook".
(define cluster-lower-first [s]
  (let [chars (split s "")]
    (reduce str (lower (first chars)) (rest chars))))

(form (command name {:keys [payload success error delivery dedupe-by guard reject update reply]})
  "Declares a message that may change the entity's state. :guard, :reject,
   :update, and :reply are pure expressions over state and the payload
   fields; :reply sees the updated state. A persisted command that updates
   state must name its :dedupe-by field."
  :examples
    [[(entity Counter
        :state {:count Int} :initial {:count 0} :storage :memory
        (command Increment :payload {:by Int} :success Int :delivery :volatile
          :update {:count (+ state.count by)} :reply state.count))]]
  :types {:name Symbol :payload (Option Type) :success Type :error (Option Type)
          :delivery (Union :persisted :volatile) :dedupe-by (Option Keyword)
          :guard (Option Syntax) :reject (Option Syntax)
          :update (Option Syntax) :reply Syntax}
  :ir ClusterCommandIR
  :check (fn [{:keys [delivery dedupe-by guard reject update]}]
    (concat
      (if (and (= delivery :persisted) (not (= update nil)) (= dedupe-by nil))
        [{:severity :error :code "cluster/unkeyed-command" :slot :delivery
          :message "A persisted command that updates state needs :dedupe-by. Without a primary key, Effect Cluster runs a retried request again and applies the update twice."
          :help "Name a payload field that identifies the request, such as :dedupe-by :request-id."}]
        [])
      (if (and (= delivery :volatile) (not (= dedupe-by nil)))
        [{:severity :error :code "cluster/dedupe-volatile" :slot :dedupe-by
          :message "Only persisted messages are deduplicated; :dedupe-by has no effect on a volatile command."}]
        [])
      (if (= (= guard nil) (= reject nil))
        []
        [{:severity :error :code "cluster/guard-reject"
          :slot (if (= guard nil) :reject :guard)
          :message "Write :guard and :reject together: :reject is the failure when the guard is false."}])))
  {:kind "ClusterCommand" :name name :payload payload :success success
   :error error :delivery delivery :dedupe-by dedupe-by :guard guard
   :reject reject :update update :reply reply :handler nil})

(form (query name {:keys [payload success reply update]})
  "Declares a read-only message. Queries are volatile and run concurrently
   with the entity's commands, so they cannot update state."
  :examples
    [[(entity Counter
        :state {:count Int} :initial {:count 0} :storage :memory
        (query Count :success Int :reply state.count))]]
  :types {:name Symbol :payload (Option Type) :success Type :reply Syntax
          :update (Option Syntax)}
  :ir ClusterQueryIR
  ; :update is accepted only to explain why a query cannot have one.
  :check (fn [{:keys [update]}]
    (if (= update nil) []
      [{:severity :error :code "cluster/query-updates" :slot :update
        :message "A query runs concurrently with commands (Rpc.fork), so it cannot update state."
        :help "Make it a command to change state."}]))
  {:kind "ClusterQuery" :name name :payload payload :success success
   :reply reply :handler nil})

(form (entity name {:keys [state initial storage accept-state-loss max-idle]} message ...)
  "Declares an Effect Cluster entity: its state, its messages, and how its
   state is stored. The cluster linker emits Entity.make and a toLayer
   handler layer."
  :examples
    [[(entity Counter
        :state {:count Int} :initial {:count 0} :storage :memory
        (command Increment :payload {:by Int} :success Int :delivery :volatile
          :update {:count (+ state.count by)} :reply state.count)
        (query Count :success Int :reply state.count))]]
  :types {:name (Declares ClusterEntityDecl) :state Type :initial Syntax
          :storage (Union :memory) :accept-state-loss (Option Bool)
          :max-idle (Option (String :pattern "^[0-9]+ (millis|seconds|minutes|hours|days)$"))
          :message (List message)}
  :ir ClusterEntityIR
  :check (fn [{:keys [name storage accept-state-loss message]}]
    (let [names (map (fn [m] m.name) message)
          persisted (filter (fn [m] (= (get m :delivery) :persisted)) message)]
      (concat
        (if (empty? message)
          [{:severity :error :code "cluster/no-messages" :slot :name
            :message "Declare at least one command or query."}]
          [])
        (if (= (count names) (count (distinct names))) []
          [{:severity :error :code "cluster/duplicate-message" :slot :message
            :message "Message names must be unique within an entity."}])
        (if (and (= storage :memory) (not (= accept-state-loss true)))
          (map (fn [m]
                 {:severity :error :code "cluster/volatile-state"
                  :at [:message m.name :delivery]
                  :message (str "This entity keeps its state in memory, but " m.name
                                " is persisted. After passivation or a restart, a retried " m.name
                                " returns its stored reply while the state starts again from :initial.")
                  :help "Make the command :volatile, or add :accept-state-loss true to the entity to acknowledge it."})
               persisted)
          []))))
  :emit (fn [ir]
    (let [entity (ts/declaration (get ir :name))
          rpc (fn [m]
                (let [options {:success (ts/schema (get m :success))}
                      options (if (get m :payload)
                                (assoc options :payload (ts/fields (get m :payload))) options)
                      options (if (get m :error)
                                (assoc options :error (ts/schema (get m :error))) options)
                      options (if (get m :dedupe-by)
                                (assoc options :primaryKey
                                  `(ts/arrow [payload] ~(ts/ref (str "payload." (get m :dedupe-by)))))
                                options)
                      made `(Rpc.make ~(get m :name) ~options)]
                  (if (= (get m :delivery) "persisted")
                    `(ts/method ~made "annotate" ClusterSchema.Persisted true)
                    made)))
          handler (fn [m]
                    (let [call (if (get m :payload)
                                 `(~(ts/operation (get m :handler)) stateRef request.payload)
                                 `(~(ts/operation (get m :handler)) stateRef))
                          body (if (= (get m :kind) "ClusterQuery") `(Rpc.fork ~call) call)]
                      (if (get m :payload) `(ts/arrow [request] ~body) `(ts/arrow [] ~body))))
          handlers (reduce (fn [acc m] (assoc acc (get m :name) (handler m))) {} (get ir :messages))
          build `(Effect.map (Ref.make ~(ts/operation (get ir :initial-name)))
                   (ts/arrow [stateRef] (ts/method ~entity "of" ~handlers)))]
      {:entity `(Entity.make ~(get ir :name) [~@(map rpc (get ir :messages))])
       :layer (if (get ir :max-idle)
                `(ts/method ~entity "toLayer" ~build {:maxIdleTime ~(get ir :max-idle)})
                `(ts/method ~entity "toLayer" ~build))}))
  (let [prefix (cluster-lower-first (str name))]
    {:kind "ClusterEntity" :name name :state state :initial initial
     :storage storage :accept-state-loss accept-state-loss :max-idle max-idle
     :state-type (str name "State") :initial-name (str prefix "Initial")
     :messages (map (fn [m] (assoc m :handler (str prefix (get m :name)))) message)}))
