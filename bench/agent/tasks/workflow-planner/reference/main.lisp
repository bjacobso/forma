(import "./forms.lisp" [workflow])
(workflow diamond :budget 40 :steps [
 {:id "end" :depends ["left" "right"] :timeout 5 :attempts 1 :manual false}
  {:id "left" :depends ["start"] :timeout 5 :attempts 2 :manual false}
  {:id "start" :depends [] :timeout 10 :attempts 1 :manual true}
  {:id "right" :depends ["start"] :timeout 5 :attempts 1 :manual false}])
(workflow empty :budget 0 :steps [])
