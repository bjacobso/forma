(import "./types.lisp" [Step Plan])
(import "./planner.lisp" [cost order problems])
(export workflow WorkflowIR)
(type WorkflowIR {:kind "Workflow" :name Symbol :cost Int :order (List String)})
(form (workflow name {:keys [budget steps]})
 :types {:name (Declares WorkflowDecl) :budget Int :steps (Expr (List {:id String :depends (List String) :timeout Int :attempts Int :manual Bool}))}
 :ir WorkflowIR
 :check (fn [h]
  (let [found (problems {:steps (get h :steps) :budget (get h :budget)})]
   (if (empty? found) [] [{:severity :error :code "workflow/invalid" :slot :steps :message (str "Invalid workflow: " found)}])))
 {:kind "Workflow" :name name :cost (cost {:steps steps :budget budget}) :order (order {:steps steps :budget budget})})
