(export connector machine)
(define name-of [x] (if (nil? x) "" (if (keyword? x) (keyword/name x) (str x))))
(define same? [a b] (= (name-of a) (name-of b)))
(define member? [x xs] (some (fn [y] (same? x y)) xs))
(define child-named [children kind] (filter (fn [c] (= (get c :kind) kind)) children))
(define diag [code message at] {:severity :error :code code :message message :at at})

(define connector/emit [ir]
  {:kind "connector"
   :name (name-of (get ir :name))
   :doc (get ir :doc)
   :capabilities (map name-of (get ir :capabilities))
   :signals (map name-of (get ir :signals))
   :owns (map name-of (get ir :owns))})

(define connector/graph [ir]
  (let [cname (name-of (get ir :name))
        cid (str "connector:" cname)]
    {:nodes [{:kind "connector"
              :name cname
              :data {:capabilities (map name-of (get ir :capabilities))
                     :signals (map name-of (get ir :signals))}}]
     :edges (map (fn [m] {:from cid :to (str "machine:" (name-of m)) :kind "owns"}) (get ir :owns))}))

(type ConnectorIR
  {:kind "Connector"
   :name Symbol
   :doc (Option String)
   :capabilities (List Symbol)
   :signals (List Symbol)
   :owns (List Symbol)})

(form (connector name doc {:keys [capabilities signals owns]})
  "An external system: outbound capabilities and inbound signals, kept apart."
  :types {:name (Declares ConnectorDef)
          :doc (Option String)
          :capabilities (List Symbol)
          :signals (List Symbol)
          :owns (Option (List (Refers MachineDef)))}
  :ir ConnectorIR
  :emit connector/emit
  :graph connector/graph
  {:kind "Connector"
   :name name
   :doc doc
   :capabilities capabilities
   :signals signals
   :owns (if (nil? owns) [] owns)})

(type StateIR {:kind "State" :name Symbol :label String})
(type TransitionIR {:kind "Transition" :from Symbol :to Symbol})
(type machine-child (Union StateIR TransitionIR))

(form (machine-child/state name label)
  :types {:name Symbol :label String}
  :ir StateIR
  {:kind "State" :name name :label label})

(form (machine-child/transition from to)
  :types {:from Symbol :to Symbol}
  :ir TransitionIR
  {:kind "Transition" :from from :to to})

(define machine/check [{:keys [initial final child]}]
  (let [states (map (fn [s] (get s :name)) (child-named child "State"))]
    (concat
      (if (member? initial states) [] [(diag "E_MACHINE_STATE" (str (name-of initial) " is not a declared state.") [:initial])])
      (flat-map (fn [s] (if (member? s states) [] [(diag "E_MACHINE_STATE" (str (name-of s) " is not a declared state.") [:final])])) final)
      (flat-map
        (fn [transition]
          (flat-map
            (fn [state] (if (member? state states) [] [(diag "E_MACHINE_STATE" (str (name-of state) " is not a declared state.") [:child])]))
            [(get transition :from) (get transition :to)]))
        (child-named child "Transition")))))

(define machine/emit [ir]
  {:kind "machine"
   :name (name-of (get ir :name))
   :doc (get ir :doc)
   :signal (name-of (get ir :signal))
   :initial (name-of (get ir :initial))
   :final (map name-of (get ir :final))
   :states (map (fn [s] {:name (name-of (get s :name)) :label (get s :label)}) (get ir :states))
   :transitions (map (fn [t] {:from (name-of (get t :from)) :to (name-of (get t :to))}) (get ir :transitions))})

(define machine/graph [ir]
  (let [mname (name-of (get ir :name))
        mid (str "machine:" mname)]
    {:nodes (concat
              [{:kind "machine"
                :name mname
                :data {:signal (name-of (get ir :signal))
                       :initial (name-of (get ir :initial))}}]
              (map (fn [s] {:kind "state"
                            :name (str mname "/" (name-of (get s :name)))
                            :data {:label (get s :label)}})
                (get ir :states)))
     :edges (concat
              (map (fn [s] {:from mid :to (str "state:" mname "/" (name-of (get s :name))) :kind "contains"})
                (get ir :states))
              (map (fn [t] {:from (str "state:" mname "/" (name-of (get t :from)))
                            :to (str "state:" mname "/" (name-of (get t :to)))
                            :kind "transitions-to"})
                (get ir :transitions)))}))

(type MachineIR
  {:kind "Machine"
   :name Symbol
   :doc (Option String)
   :signal Symbol
   :initial Symbol
   :final (List Symbol)
   :states (List StateIR)
   :transitions (List TransitionIR)})

(form (machine name doc {:keys [signal initial final]} child ...)
  "A protocol state machine owned by a connector."
  :types {:name (Declares MachineDef)
          :doc (Option String)
          :signal Symbol
          :initial Symbol
          :final (List Symbol)
          :child (List machine-child)}
  :check machine/check
  :ir MachineIR
  :emit machine/emit
  :graph machine/graph
  {:kind "Machine"
   :name name
   :doc doc
   :signal signal
   :initial initial
   :final final
   :states (child-named child "State")
   :transitions (child-named child "Transition")})
