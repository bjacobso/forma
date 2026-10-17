(export tool ToolDecl)

(type ToolDecl Symbol)
(type ToolIR {:kind "Tool" :name Symbol :doc String})

(form (tool name doc)
  "Declare a tool an agent may call."
  :types {:name (Declares ToolDecl) :doc String}
  :ir ToolIR
  {:kind "Tool" :name name :doc doc})
