; elm.lisp
; -----------------------------------------------------------------------------
; Purpose: Elm-style message, command, update, view, and application declarations.
; Requires: compiler.lisp; bootstrap separately from the ontology and HTTP API stacks.
; Used by: The optional TypeScript Elm linker and its Foldkit prototype examples.
; -----------------------------------------------------------------------------

; The view linker accepts only these Hiccup element tags.
(type ElmElementTag (Union :div :span :button))
; Text-valued Hiccup attributes; keywords select HtmlBuilder methods.
(type ElmTextAttribute (Union :class))
; Message-valued Hiccup event attributes checked by the Elm linker.
(type ElmMessageAttribute (Union :on-click))

(type ElmMessagesIR {:kind "ElmMessages" :variants (List RuntimeExpr)})
(type ElmCommandIR
  {:kind "ElmCommand" :name Symbol :operation Symbol
   :ok RuntimeExpr :error (Option RuntimeExpr)})
(type ElmUpdateIR {:kind "ElmUpdate" :bindings RuntimeExpr :cases (List RuntimeExpr)})
(type ElmViewIR {:kind "ElmView" :bindings RuntimeExpr :tree RuntimeExpr})
(type ElmAppIR {:kind "ElmApp" :name Symbol :model Symbol :init RuntimeExpr})

(form (msg variant ...)
  "Declares message variant syntax for the Elm linker, which builds the Msg
   tagged type."
  :examples
    [[(type Model {:count Int})
      (msg Increment)
      (update [model message]
        Increment
        (with (assoc model :count (+ model.count 1))))
      (view [model] [:div (str model.count)])
      (app Counter :model Model :init (with (Model {:count 0})))]]
  :types {:variant (List Syntax)}
  :ir ElmMessagesIR
  {:kind "ElmMessages" :variants variant})

(form (command name operation {:keys [ok error]})
  "Declares a named command linked to an operation and success and optional
   error message syntax."
  :examples
    [[(type Model {:count Int})
      (: read-count (Effect Int))
      (define read-count 1)
      (msg Load (Loaded {:count Int}))
      (command load read-count :ok [n (Loaded {:count n})])
      (update [model message]
        Load
        (with model :load)
        (Loaded {:count n})
        (with (assoc model :count n)))
      (view [model] [:div (str model.count)])
      (app Counter :model Model :init (with (Model {:count 0})))]]
  :types {:name (Declares ElmCommand) :operation Symbol
          :ok Syntax :error (Option Syntax)}
  :ir ElmCommandIR
  :emit (fn [ir]
    `(Command.define ~(get ir :name)
       {:messages [Msg]
        :execute ~(ts/operation (str "elm-command-" (get ir :name)))}))
  {:kind "ElmCommand" :name name :operation operation :ok ok :error error})

(form (update bindings case ...)
  "Captures model and message bindings and update cases for the Elm linker
   to typecheck and lower."
  :examples
    [[(type Model {:count Int})
      (msg Increment)
      (update [model message]
        Increment
        (with (assoc model :count (+ model.count 1))))
      (view [model] [:div (str model.count)])
      (app Counter :model Model :init (with (Model {:count 0})))]]
  :types {:bindings Syntax :case (List Syntax)}
  :ir ElmUpdateIR
  {:kind "ElmUpdate" :bindings bindings :cases case})

(form (view bindings tree)
  "Captures model bindings and a Hiccup tree. The Elm linker checks element
   tags, attributes, and message handlers."
  :examples
    [[(type Model {:count Int})
      (msg Increment)
      (update [model message]
        Increment
        (with (assoc model :count (+ model.count 1))))
      (view [model] [:div (str model.count)])
      (app Counter :model Model :init (with (Model {:count 0})))]]
  :types {:bindings Syntax :tree Syntax}
  :ir ElmViewIR
  {:kind "ElmView" :bindings bindings :tree tree})

(form (app name {:keys [model init]})
  "Declares an Elm application name, model type, and initial model
   expression; the linker combines its messages, update, view, and commands."
  :examples
    [[(type Model {:count Int})
      (msg Increment)
      (update [model message]
        Increment
        (with (assoc model :count (+ model.count 1))))
      (view [model] [:div (str model.count)])
      (app Counter :model Model :init (with (Model {:count 0})))]]
  :types {:name (Declares ElmApp) :model Symbol :init Syntax}
  :ir ElmAppIR
  :emit (fn [ir]
    `{:Model ~(ts/declaration (get ir :model))
      :init init :update update :view view})
  {:kind "ElmApp" :name name :model model :init init})
