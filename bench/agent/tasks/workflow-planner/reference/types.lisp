(export Step Plan)
(type Step {:id String :depends (List String) :timeout Int :attempts Int :manual Bool})
(type Plan {:steps (List Step) :budget Int})
