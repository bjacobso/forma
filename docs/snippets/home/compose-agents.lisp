(import "./tools.forma" [ToolDecl])
(export allow)

(type AllowDecl Symbol)
(type AllowIR {:kind "Allow" :name Symbol :tool Symbol})

(form (allow name tool)
  "Let an agent call one declared tool."
  :types {:name (Declares AllowDecl) :tool (Refers ToolDecl)}
  :ir AllowIR
  {:kind "Allow" :name name :tool tool})
