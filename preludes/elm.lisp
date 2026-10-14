; Elm-style application vocabulary. The optional TypeScript linker lowers the
; expression holes through the existing Effect checker; neither engine's core
; knows about messages, commands, update, or Hiccup.
; The view linker reads these closed vocabularies from the descriptor's types.
; Attribute keywords derive the target HtmlBuilder method names.
(type ElmElementTag (Union :div :span :button))
(type ElmTextAttribute (Union :class))
(type ElmMessageAttribute (Union :on-click))

(type ElmMessagesIR {:kind "ElmMessages" :variants (List RuntimeExpr)})
(type ElmCommandIR
  {:kind "ElmCommand" :name Symbol :operation Symbol
   :ok RuntimeExpr :error (Option RuntimeExpr)})
(type ElmUpdateIR {:kind "ElmUpdate" :bindings RuntimeExpr :cases (List RuntimeExpr)})
(type ElmViewIR {:kind "ElmView" :bindings RuntimeExpr :tree RuntimeExpr})
(type ElmAppIR {:kind "ElmApp" :name Symbol :model Symbol :init RuntimeExpr})

(form (msg variant ...)
  :types {:variant (List Syntax)}
  :ir ElmMessagesIR
  {:kind "ElmMessages" :variants variant})

(form (command name operation {:keys [ok error]})
  :types {:name (Declares ElmCommand) :operation Symbol
          :ok Syntax :error (Option Syntax)}
  :ir ElmCommandIR
  :emit (fn [ir]
    `(Command.define ~(get ir :name)
       {:messages [Msg]
        :execute ~(ts/operation (str "elm-command-" (get ir :name)))}))
  {:kind "ElmCommand" :name name :operation operation :ok ok :error error})

(form (update bindings case ...)
  :types {:bindings Syntax :case (List Syntax)}
  :ir ElmUpdateIR
  {:kind "ElmUpdate" :bindings bindings :cases case})

(form (view bindings tree)
  :types {:bindings Syntax :tree Syntax}
  :ir ElmViewIR
  {:kind "ElmView" :bindings bindings :tree tree})

(form (app name {:keys [model init]})
  :types {:name (Declares ElmApp) :model Symbol :init Syntax}
  :ir ElmAppIR
  :emit (fn [ir]
    `{:Model ~(ts/declaration (get ir :model))
      :init init :update update :view view})
  {:kind "ElmApp" :name name :model model :init init})
