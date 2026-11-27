; workflow-laws.lisp
; -----------------------------------------------------------------------------
; Purpose: Finite workflow and evidence safety law declarations for bounded
;          fixed-point verification (RFC 0028 Stage 1).
; Requires: compiler.lisp; bootstrap separately from the ontology stack.
; Used by: @formalang/ts bounded workflow explorer (browser-safe).
; -----------------------------------------------------------------------------

(type WorkflowDomainIR
  {:kind "WorkflowDomain" :name Symbol :values RuntimeExpr})

(type WorkflowInitialIR
  {:kind "WorkflowInitial" :expr RuntimeExpr})

(type WorkflowTransitionIR
  {:kind "WorkflowTransition"
   :name Symbol
   :params (Option RuntimeExpr)
   :guard (Option RuntimeExpr)
   :update RuntimeExpr})

(type WorkflowLawIR
  {:kind "WorkflowLaw"
   :name Symbol
   :when (Option RuntimeExpr)
   :holds RuntimeExpr
   :description (Option String)})

(type workflow-item
  (Union WorkflowDomainIR WorkflowInitialIR WorkflowTransitionIR WorkflowLawIR))

(type WorkflowModelIR
  {:kind "WorkflowModel"
   :name Symbol
   :assumptions (Option (List String))
   :items (List workflow-item)})

(form (domain name values)
  "Declares a finite value domain (enum or finite list of ground values) over
   which transition parameters range during bounded exploration."
  :examples
    [[(workflow-model Minimal
        (domain Revision ["v1" "v2"])
        (initial {:revision "v1"})
        (transition advance
          :guard (= state.revision "v1")
          :update (assoc state :revision "v2"))
        (law valid-revision
          :holds (or (= state.revision "v1") (= state.revision "v2"))))]]
  :types {:name Symbol :values Syntax}
  :ir WorkflowDomainIR
  {:kind "WorkflowDomain" :name name :values values})

(form (initial expr)
  "Declares an initial finite state expression for bounded reachable-state
   exploration. Multiple initial forms define multiple starting states."
  :examples
    [[(workflow-model Minimal
        (domain Revision ["v1" "v2"])
        (initial {:revision "v1"})
        (transition advance
          :guard (= state.revision "v1")
          :update (assoc state :revision "v2"))
        (law valid-revision
          :holds (or (= state.revision "v1") (= state.revision "v2"))))]]
  :types {:expr Syntax}
  :ir WorkflowInitialIR
  {:kind "WorkflowInitial" :expr expr})

(form (transition name {:keys [params guard update]})
  "Declares a named workflow transition with optional finite parameter bindings,
   a pure decidable :guard predicate, and a pure :update state expression."
  :examples
    [[(workflow-model Minimal
        (domain Worker ["w1" "w2"])
        (initial {:active "none"})
        (transition claim
          :params {:worker Worker}
          :guard (= state.active "none")
          :update (assoc state :active worker))
        (law known-worker
          :holds (or (= state.active "none") (= state.active "w1") (= state.active "w2"))))]]
  :types {:name Symbol
          :params (Option Syntax)
          :guard (Option Syntax)
          :update Syntax}
  :ir WorkflowTransitionIR
  {:kind "WorkflowTransition" :name name :params params :guard guard :update update})

(form (law name {:keys [when holds description]})
  "Declares a safety invariant over reachable workflow states. When :when is
   supplied, :holds is checked whenever :when is true, and a law whose :when
   premise never holds in any reachable state is reported as vacuous."
  :examples
    [[(workflow-model Minimal
        (initial {:released false :authorized false})
        (transition authorize
          :guard (not state.authorized)
          :update (assoc state :authorized true))
        (transition release
          :guard state.authorized
          :update (assoc state :released true))
        (law release-requires-auth
          :description "Every release must be authorized."
          :when state.released
          :holds state.authorized))]]
  :types {:name Symbol
          :when (Option Syntax)
          :holds Syntax
          :description (Option String)}
  :ir WorkflowLawIR
  {:kind "WorkflowLaw" :name name :when when :holds holds :description description})

(form (workflow-model name {:keys [assumptions]} item ...)
  "Groups finite domains, initial states, transitions, and safety laws into a
   bounded verification model for fixed-point reachable-state exploration."
  :examples
    [[(workflow-model Minimal
        :assumptions ["Finite two-revision model; no unbounded clock."]
        (domain Revision ["v1" "v2"])
        (initial {:revision "v1"})
        (transition advance
          :guard (= state.revision "v1")
          :update (assoc state :revision "v2"))
        (law valid-revision
          :holds (or (= state.revision "v1") (= state.revision "v2"))))]]
  :types {:name (Declares WorkflowModelDecl)
          :assumptions (Option (List String))
          :item (List workflow-item)}
  :ir WorkflowModelIR
  {:kind "WorkflowModel" :name name :assumptions assumptions :items item})
