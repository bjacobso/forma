(export connector machine)
(define name-of [x] (if (nil? x) "" (if (keyword? x) (keyword/name x) (str x))))
(define same? [a b] (= (name-of a) (name-of b)))
(define member? [x xs] (some (fn [y] (same? x y)) xs))
(define child-named [children kind] (filter (fn [c] (= (get c :kind) kind)) children))
(define diag [code message at] {:severity :error :code code :message message :at at})
; ── Connectors and machines ──

(type
  ConnectorIR
  {
    :kind "Connector"
    :name Symbol
    :doc (Option String)
    :capabilities (List Symbol)
    :signals (List Symbol)
    :owns (List Symbol)})
(form
  (connector name doc {:keys [capabilities signals owns]})
  "An external system: outbound capabilities and inbound signals, kept apart."
  :types
    {
      :name (Declares ConnectorDef)
      :doc (Option String)
      :capabilities (List Symbol)
      :signals (List Symbol)
      :owns (Option (List (Refers MachineDef)))}
  :ir ConnectorIR
  {:kind "Connector" :name name :doc doc :capabilities capabilities :signals signals :owns (if (nil? owns) [] owns)})

(type StateIR {:kind "State" :name Symbol :label String})
(type TransitionIR {:kind "Transition" :from Symbol :to Symbol})
(type machine-child (Union StateIR TransitionIR))
(form (machine-child/state name label) :types {:name Symbol :label String} :ir StateIR {:kind "State" :name name :label label})
(form
  (machine-child/transition from to)
  :types {:from Symbol :to Symbol}
  :ir TransitionIR
  {:kind "Transition" :from from :to to})
(define
  machine/check
  [{:keys [initial final child]}]
  (let
    [states (map (fn [s] (get s :name)) (child-named child "State"))]
    (concat
      (if (member? initial states) [] [(diag "E_MACHINE_STATE" (str (name-of initial) " is not a declared state.") [:initial])])
      (flat-map (fn [s] (if (member? s states) [] [(diag "E_MACHINE_STATE" (str (name-of s) " is not a declared state.") [:final])])) final)
      (flat-map
        (fn
          [transition]
          (flat-map
            (fn [state] (if (member? state states) [] [(diag "E_MACHINE_STATE" (str (name-of state) " is not a declared state.") [:child])]))
            [(get transition :from) (get transition :to)]))
        (child-named child "Transition")))))
(type
  MachineIR
  {
    :kind "Machine"
    :name Symbol
    :doc (Option String)
    :signal Symbol
    :initial Symbol
    :final (List Symbol)
    :states (List StateIR)
    :transitions (List TransitionIR)})
(form
  (machine name doc {:keys [signal initial final]} child ...)
  "A vendor protocol: set :signal to a name declared in a connector's :signals, and list this machine in that connector's :owns. Signal-only connectors use :capabilities []."
  :types
    {
      :name (Declares MachineDef)
      :doc (Option String)
      :signal Symbol
      :initial Symbol
      :final (List Symbol)
      :child (List machine-child)}
  :check machine/check
  :ir MachineIR
  {
    :kind "Machine"
    :name name
    :doc doc
    :signal signal
    :initial initial
    :final final
    :states (child-named child "State")
    :transitions (child-named child "Transition")})

