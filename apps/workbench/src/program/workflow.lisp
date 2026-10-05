; workflow.lisp
; -----------------------------------------------------------------------------
; Workflow prelude: steps that call external systems, and workflows that order
; them. Bootstrap after compiler.lisp:
;
;   bootstrapFromSources(preludeSource("compiler.lisp"), workflowLisp)
;
; Authoring example:
;
;   (define-step verify-identity
;     (:system "Persona")
;     (:writes [:identity]))
;
;   (define-workflow onboarding
;     (:steps
;       verify-identity
;       (parallel collect-i9 background-check)
;       activate))
;
; `:steps` is a sequence. `(parallel ...)` runs its items concurrently and
; `(sequence ...)` runs them in order; both nest.
; -----------------------------------------------------------------------------

(define-form define-step
  (:phase domain)
  (:doc "A unit of work performed by an external system.")
  (:identifiers
    (identifier name Symbol (:declaration true) (:doc "The step's name.")))
  (:slots
    (slot system value (:required true) (:doc "The system that performs the step."))
    (slot reads value (:doc "Data keys the step reads, e.g. [:identity]."))
    (slot writes value (:doc "Data keys the step writes, e.g. [:check]."))
    (slot doc value (:doc "What the step does.")))
  (:construct-fn step/construct))

(define-form define-workflow
  (:phase domain)
  (:doc "An ordered flow of steps.")
  (:identifiers
    (identifier name Symbol (:declaration true) (:doc "The workflow's name.")))
  (:slots
    (slot steps form (:required true) (:doc "Steps in order; may contain (parallel ...) and (sequence ...)."))
    (slot doc value (:doc "What the workflow does.")))
  (:construct-fn workflow/construct))

(define-form parallel
  (:phase domain)
  (:doc "Runs its steps concurrently. Used inside define-workflow :steps."))

(define-form sequence
  (:phase domain)
  (:doc "Runs its steps in order. Used inside define-workflow :steps."))

(meta-fn step/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output StepIR)
  (:doc "Lowers a step to {kind, name, system, reads, writes, doc}.")
  (:body
    (construct/object
      :kind "Step"
      :name (meta/declaration-name input)
      :system (meta/slot-string input :system)
      :reads (meta/slot-string-list input :reads)
      :writes (meta/slot-string-list input :writes)
      :doc (meta/slot-string input :doc))))

; Meta-fn bodies have no named recursion, so the flow walker receives itself.
; `:steps` lowers to nested lists of symbol names, e.g.
; ["a", ["parallel", "b", "c"], "d"].
(meta-fn workflow/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output WorkflowIR)
  (:doc "Lowers a workflow to a flow tree and rejects references to unknown steps.")
  (:body
    (let [flow-node (fn [self item]
                      (if (string? item)
                        (let [decl (meta/lookup-declaration input item)]
                          (if (nil? decl)
                            (fail (str "Unknown step '" item "' in workflow " (meta/declaration-name input)))
                            (if (= (get decl "kind") "define-step")
                              (construct/object :kind "step" :step item)
                              (fail (str "'" item "' is a " (get decl "kind") ", not a step")))))
                        (if (if (= (first item) "parallel") true (= (first item) "sequence"))
                          (construct/object
                            :kind (first item)
                            :items (map (fn [child] (self self child)) (rest item)))
                          (fail (str "Expected a step, (parallel ...), or (sequence ...) in workflow "
                                     (meta/declaration-name input))))))
          steps (get (meta/slot-runtime-expr input :steps) "expr")]
      (construct/object
        :kind "Workflow"
        :name (meta/declaration-name input)
        :doc (meta/slot-string input :doc)
        :flow (construct/object
                :kind "sequence"
                :items (map (fn [item] (flow-node flow-node item)) steps))))))
