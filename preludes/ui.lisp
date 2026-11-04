; ui.lisp
; -----------------------------------------------------------------------------
; Purpose: Domain-neutral UI forms and constant hosted renderer configuration.
; Requires: compiler.lisp and core builtins; no ontology vocabulary.
; Used by: ViewSpec layouts, descriptor-tree tooling, and downstream host renderers.
; -----------------------------------------------------------------------------
; =============================================================================
; SECTION 1 — COMPONENT PROJECTION
; =============================================================================
; Portable component configuration, not a renderer: string name, JSON
; properties, and projected children.
(type ComponentIR {:component String :props Json :children (List Json)})

; Child-form category shared by all UI and ViewSpec component forms.
(type component ComponentIR)

; Constructs configuration without interpreting renderer behavior.
(define component [name props children]
  {:component name :props props :children children})

; =============================================================================
; SECTION 2 — CONTENT AND BASIC CONTAINERS
; =============================================================================
(define text.metadata
  '{
     :descriptor-name "text"
     :extensions
       {
         :view/component
           {
             :allows-bind true
             :compile {:expr-props ["visible" "bind"]}
             :children "none"
             :positional-prop "content"}}})

(form (text content {:keys [visible bind]})
  "Builds a text configuration node from content or a binding expression; it
   accepts no children."
  :examples
    [[(view Example :layout (text "Hello"))]]
  :types
    {
      :content (Option (Expr a))
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))}
  :ir ComponentIR
  (component "text" {"content" content "visible" visible "bind" bind} []))

(define rows.metadata
  '{
     :descriptor-name "rows"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"] :required-children true}
             :children "any"}}})

(form (rows {:keys [gap visible]} child ...)
  "Builds a rows container with optional gap and visibility; hosted layouts
   require children."
  :examples
    [[(view Example :layout (rows :gap 8 (text "First") (text "Second")))]]
  :types
    {:gap (Option Float) :visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "rows" {"gap" gap "visible" visible} child))

(define columns.metadata
  '{
     :descriptor-name "columns"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"] :required-children true}
             :children "any"}}})

(form (columns {:keys [gap visible]} child ...)
  "Builds a columns container with optional gap and visibility; hosted
   layouts require children."
  :examples
    [[(view Example :layout (columns :gap 12 (text "Left") (text "Right")))]]
  :types
    {:gap (Option Float) :visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "columns" {"gap" gap "visible" visible} child))

(define card.metadata
  '{
     :descriptor-name "card"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile
               {
                 :expr-props ["visible"]
                 :required-children true
                 :node-slots ["action" "footer"]}
             :children "any"}}})

(form
  (card
    {:keys [title description subject-mode action footer visible]}
    child
    ...)
  "Builds a card container with title and description expressions and
   optional action and footer nodes."
  :examples
    [[(view Example :layout (card :title "Profile" (text "Ada")))]]
  :types
    {
      :title (Option (Expr a))
      :description (Option (Expr a))
      :subject-mode (Option (Expr a))
      :action (Option Syntax)
      :footer (Option Syntax)
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component
    "card"
    {
      "title" title
      "description" description
      "subject-mode" subject-mode
      "action" action
      "footer" footer
      "visible" visible}
    child))

(define item-group.metadata
  '{
     :descriptor-name "item-group"
     :extensions
       {
         :view/component
           {
             :allows-bind true
             :compile {:expr-props ["visible" "bind"] :required-children true}
             :children "any"}}})

(form (item-group {:keys [visible bind]} child ...)
  "Groups item nodes, optionally binding the group to an expression."
  :examples
    [[(view Example :layout (item-group (item :title "Compiler")))]]
  :types
    {
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))
      :child (List component)}
  :ir ComponentIR
  (component "item-group" {"visible" visible "bind" bind} child))

(define item.metadata
  '{
     :descriptor-name "item"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "any"
             :events {:on-click "onClick"}}}})

(form
  (item
    {
      :keys
        [variant size icon title description value badge badge-variant visible]}
    child
    ...)
  "Builds an item node with optional icon, text, value, badge, and nested
   content."
  :examples
    [[(view Example :layout (item :title "Compiler" :description "Ready"))]]
  :types
    {
      :variant (Option (Union "default" "outline" "muted"))
      :size (Option (Union "default" "sm" "xs"))
      :icon (Option String)
      :title (Option (Expr a))
      :description (Option (Expr a))
      :value (Option (Expr a))
      :badge (Option (Expr a))
      :badge-variant
        (Option (Union "default" "secondary" "outline" "destructive"))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component
    "item"
    {
      "variant" variant
      "size" size
      "icon" icon
      "title" title
      "description" description
      "value" value
      "badge" badge
      "badge-variant" badge-variant
      "visible" visible}
    child))

(define button.metadata
  '{
     :descriptor-name "button"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible" "disabled"]}
             :children "any"
             :events {:on-click "onClick"}
             :positional-prop "label"}}})

(form
  (button label {:keys [variant size disabled button-type visible]} child ...)
  "Builds a button node with a label expression, variant, size, disabled
   expression, and optional children."
  :examples
    [[(view Example :layout (button "Save" :variant "default"))]]
  :types
    {
      :label (Option (Expr a))
      :variant
        (Option
          (Union "default" "destructive" "outline" "secondary" "ghost" "link"))
      :size (Option (Union "default" "sm" "lg" "icon"))
      :disabled (Option (Expr a))
      :button-type (Option (Union "button" "submit" "reset"))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component
    "button"
    {
      "label" label
      "variant" variant
      "size" size
      "disabled" disabled
      "button-type" button-type
      "visible" visible}
    child))

(define progress.metadata
  '{
     :descriptor-name "progress"
     :extensions
       {
         :view/component
           {
             :allows-bind true
             :compile {:expr-props ["visible" "bind"]}
             :children "none"}}})

(form (progress {:keys [value label hint visible bind]})
  "Builds a progress node with value, label, and hint expressions or a
   binding."
  :examples
    [[(view Example :layout (progress :value 50 :label "Halfway"))]]
  :types
    {
      :value (Option (Expr a))
      :label (Option (Expr a))
      :hint (Option (Expr a))
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))}
  :ir ComponentIR
  (component
    "progress"
    {"value" value "label" label "hint" hint "visible" visible "bind" bind}
    []))

(define workflow-strip.metadata
  '{
     :descriptor-name "workflow-strip"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :children ["only" ["workflow-step"]]
             :compile {:required-children true}}}})

(form (workflow-strip {:keys [title description visible]} child ...)
  "Groups workflow-step nodes under optional title and description
   expressions."
  :examples
    [[(view Example :layout (workflow-strip (workflow-step :label "Review")))]]
  :types
    {
      :title (Option (Expr a))
      :description (Option (Expr a))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component
    "workflow-strip"
    {"title" title "description" description "visible" visible}
    child))

(define workflow-step.metadata
  '{
     :descriptor-name "workflow-step"
     :extensions
       {
         :view/component
           {:allows-bind false :children "none" :parents ["workflow-strip"]}}})

(form (workflow-step {:keys [label description status icon visible]})
  "Builds one workflow step with a required label expression and optional
   description, status, and icon."
  :examples
    [[(view Example
        :layout
          (workflow-strip (workflow-step :label "Review" :status "pending")))]]
  :types
    {
      :label (Expr a)
      :description (Option (Expr a))
      :status (Option (Expr a))
      :icon (Option String)
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component
    "workflow-step"
    {
      "label" label
      "description" description
      "status" status
      "icon" icon
      "visible" visible}
    []))

(define empty-state.metadata
  '{
     :descriptor-name "empty-state"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "any"}}})

(form (empty-state {:keys [icon title description visible]} child ...)
  "Builds an empty-state container with optional icon, title, description,
   and child nodes."
  :examples
    [[(view Example
        :layout (empty-state :title "No records" (button "Create")))]]
  :types
    {
      :icon (Option String)
      :title (Option (Expr a))
      :description (Option (Expr a))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component
    "empty-state"
    {"icon" icon "title" title "description" description "visible" visible}
    child))

(define badge.metadata
  '{
     :descriptor-name "badge"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "none"
             :positional-prop "content"}}})

(form (badge content {:keys [variant dot dot-color visible]})
  "Builds a badge node from a content expression and optional variant and
   dot configuration."
  :examples
    [[(view Example :layout (badge "Ready" :variant "secondary"))]]
  :types
    {
      :content (Option (Expr a))
      :variant (Option (Union "default" "secondary" "outline" "destructive"))
      :dot (Option Json)
      :dot-color (Option String)
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component
    "badge"
    {
      "content" content
      "variant" variant
      "dot" dot
      "dot-color" dot-color
      "visible" visible}
    []))

(define avatar.metadata
  '{
     :descriptor-name "avatar"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "none"}}})

(form (avatar {:keys [src alt fallback size visible]})
  "Builds an avatar node with source, alternative text, fallback
   expressions, and optional size."
  :examples
    [[(view Example :layout (avatar :fallback "AJ" :alt "Ada"))]]
  :types
    {
      :src (Option (Expr a))
      :alt (Option (Expr a))
      :fallback (Option (Expr a))
      :size (Option (Union "default" "sm" "lg"))
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component
    "avatar"
    {"src" src "alt" alt "fallback" fallback "size" size "visible" visible}
    []))

(define kbd.metadata
  '{
     :descriptor-name "kbd"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "none"
             :positional-prop "content"}}})

(form (kbd content {:keys [visible]})
  "Builds a keyboard-hint node from a content expression."
  :examples
    [[(view Example :layout (kbd "Enter"))]]
  :types {:content (Option (Expr a)) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "kbd" {"content" content "visible" visible} []))

(define spinner.metadata
  '{
     :descriptor-name "spinner"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "none"}}})

(form (spinner {:keys [label size visible]})
  "Builds a spinner node with an optional label expression and size."
  :examples
    [[(view Example :layout (spinner :label "Loading"))]]
  :types
    {
      :label (Option (Expr a))
      :size (Option (Union "sm" "default" "lg"))
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "spinner" {"label" label "size" size "visible" visible} []))

(define separator.metadata
  '{
     :descriptor-name "separator"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "none"}}})

(form (separator {:keys [orientation visible]})
  "Builds a separator node with optional horizontal or vertical orientation."
  :examples
    [[(view Example :layout (separator :orientation "vertical"))]]
  :types
    {
      :orientation (Option (Union "horizontal" "vertical"))
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "separator" {"orientation" orientation "visible" visible} []))

; =============================================================================
; SECTION 3 — COMPOSED LAYOUTS AND BRANCHES
; =============================================================================
(define tabs.metadata
  '{
     :descriptor-name "tabs"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"] :required-children true}
             :children ["only" ["tab-panel"]]}}})

(form (tabs {:keys [visible]} child ...)
  "Builds a container whose children must be tab-panel nodes."
  :examples
    [[(view Example
        :layout (tabs (tab-panel :label "Overview" (text "Hello"))))]]
  :types {:visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "tabs" {"visible" visible} child))

(define tab-panel.metadata
  '{
     :descriptor-name "tab-panel"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile
               {
                 :expr-props ["visible"]
                 :required-children true
                 :extra-fields
                   [
                     {
                       :name "title"
                       :optional true
                       :ts "ViewExpr"
                       :schema "ViewExpression"}]
                 :extra-normalize-fields
                   [{:field "title" :keys ["title" "label"] :kind "expr"}]}
             :children "any"
             :parents ["tabs"]}}})

(form (tab-panel {:keys [label visible]} child ...)
  "Builds a labeled panel that belongs inside tabs and contains child nodes."
  :examples
    [[(view Example
        :layout (tabs (tab-panel :label "Overview" (text "Hello"))))]]
  :types
    {
      :label (Option (Expr a))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "tab-panel" {"label" label "visible" visible} child))

(define accordion.metadata
  '{
     :descriptor-name "accordion"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"] :required-children true}
             :children ["only" ["accordion-item"]]}}})

(form (accordion {:keys [mode visible]} child ...)
  "Builds an accordion of accordion-item children, with single or multiple
   expansion mode."
  :examples
    [[(view Example
        :layout
          (accordion
            :mode "single"
            (accordion-item :title "Details" (text "Hello"))))]]
  :types
    {
      :mode (Option (Union "single" "multiple"))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "accordion" {"mode" mode "visible" visible} child))

(define accordion-item.metadata
  '{
     :descriptor-name "accordion-item"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"] :required-children true}
             :children "any"
             :parents ["accordion"]}}})

(form (accordion-item {:keys [title default-open visible]} child ...)
  "Builds an accordion section with optional title and default-open
   configuration and nested content."
  :examples
    [[(view Example
        :layout (accordion (accordion-item :title "Details" (text "Hello"))))]]
  :types
    {
      :title (Option (Expr a))
      :default-open (Option Json)
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component
    "accordion-item"
    {"title" title "default-open" default-open "visible" visible}
    child))

(define grid.metadata
  '{
     :descriptor-name "grid"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"] :required-children true}
             :children "any"}}})

(form (grid {:keys [columns visible]} child ...)
  "Builds a grid container with an optional column count and child nodes."
  :examples
    [[(view Example :layout (grid :columns 2 (text "First") (text "Second")))]]
  :types
    {
      :columns (Option Float)
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "grid" {"columns" columns "visible" visible} child))

(define aspect-ratio.metadata
  '{
     :descriptor-name "aspect-ratio"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"] :required-children true}
             :children "any"}}})

(form (aspect-ratio {:keys [ratio visible]} child ...)
  "Builds a container with an optional numeric aspect ratio and child nodes."
  :examples
    [[(view Example :layout (aspect-ratio :ratio 1.5 (text "Preview")))]]
  :types
    {
      :ratio (Option Float)
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "aspect-ratio" {"ratio" ratio "visible" visible} child))

(define spacer.metadata
  '{
     :descriptor-name "spacer"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "none"}}})

(form (spacer {:keys [height visible]})
  "Builds a spacer node with optional numeric height."
  :examples
    [[(view Example :layout (spacer :height 16))]]
  :types {:height (Option Float) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "spacer" {"height" height "visible" visible} []))

(define split-pane.metadata
  '{
     :descriptor-name "split-pane"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile
               {
                 :expr-props ["visible"]
                 :required-children true
                 :slot-normalize-kinds {:sizes "number-array"}
                 :slot-types {:sizes {:kind "array" :item "number"}}}
             :children "any"}}})

(form (split-pane {:keys [direction sizes visible]} child ...)
  "Builds a split-pane container with optional direction and JSON sizes
   configuration."
  :examples
    [[(view Example
        :layout
          (split-pane :direction "horizontal" (text "Left") (text "Right")))]]
  :types
    {
      :direction (Option (Union "horizontal" "vertical"))
      :sizes (Option Json)
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component
    "split-pane"
    {"direction" direction "sizes" sizes "visible" visible}
    child))

(define for-each.metadata
  '{
     :descriptor-name "for-each"
     :extensions
       {
         :view/component
           {
             :allows-bind true
             :compile
               {
                 :expr-props ["visible" "bind"]
                 :required-children true
                 :required-bind true}
             :children "any"}}})

(form (for-each {:keys [empty-text visible bind]} child ...)
  "Builds a repeating container with a required binding in hosted layouts
   and optional empty text."
  :examples
    [[(view Example
        :state {:items []}
        :layout (for-each :bind $state.items (text "Item")))]]
  :types
    {
      :empty-text (Option String)
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))
      :child (List component)}
  :ir ComponentIR
  (component
    "for-each"
    {"empty-text" empty-text "visible" visible "bind" bind}
    child))

(define condition.metadata
  '{
     :descriptor-name "condition"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"] :required-children true}
             :children ["only" ["case" "else"]]}}})

(form (condition {:keys [visible]} child ...)
  "Builds a conditional container restricted to case and else children."
  :examples
    [[(view Example
        :layout
          (condition (case :when true (text "Ready")) (else (text "Waiting"))))]]
  :types {:visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "condition" {"visible" visible} child))

(define case.metadata
  '{
     :descriptor-name "case"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile
               {
                 :expr-props ["visible"]
                 :required-children true
                 :slot-defaults {:when "false-expr-or-bind"}}
             :children "any"
             :parents ["condition"]}}})

(form (case {:keys [when visible]} child ...)
  "Builds a conditional branch with a required when expression and child
   nodes, inside condition."
  :examples
    [[(view Example :layout (condition (case :when true (text "Ready"))))]]
  :types {:when (Expr a) :visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "case" {"when" when "visible" visible} child))

(define else.metadata
  '{
     :descriptor-name "else"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"] :required-children true}
             :children "any"
             :parents ["condition"]}}})

(form (else {:keys [visible]} child ...)
  "Builds the fallback branch of a condition container."
  :examples
    [[(view Example
        :layout
          (condition
            (case :when false (text "Ready"))
            (else (text "Waiting"))))]]
  :types {:visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "else" {"visible" visible} child))

(define slot.metadata
  '{
     :descriptor-name "slot"
     :extensions
       {
         :view/component
           {
             :allows-bind true
             :compile {:expr-props ["visible" "bind"]}
             :children "any"
             :positional-prop "name"}}})

(form (slot name {:keys [visible bind]} child ...)
  "Builds a named or unnamed layout slot with optional binding and fallback
   child nodes."
  :examples
    [[(view Example :layout (slot "body" (text "Fallback")))]]
  :types
    {
      :name (Option String)
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))
      :child (List component)}
  :ir ComponentIR
  (component "slot" {"name" name "visible" visible "bind" bind} child))

(define use.metadata
  '{
     :descriptor-name "use"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "any"
             :positional-prop "name"}}})

(form (use name {:keys [overrides visible]} child ...)
  "Refers to a reusable layout definition by string name, with optional JSON
   overrides and child nodes."
  :examples
    [[(view Example :defs {:greeting (text "Hello")} :layout (use "greeting"))]]
  :types
    {
      :name String
      :overrides (Option Json)
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "use" {"name" name "overrides" overrides "visible" visible} child))

; =============================================================================
; SECTION 4 — OVERLAYS
; =============================================================================
(define tooltip.metadata
  '{
     :descriptor-name "tooltip"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"] :required-children true}
             :children "any"}}})

(form (tooltip {:keys [content side visible]} child ...)
  "Builds a tooltip wrapper with a required content expression, optional
   side, and child nodes."
  :examples
    [[(view Example :layout (tooltip :content "Save changes" (button "Save")))]]
  :types
    {
      :content (Expr a)
      :side (Option (Union "top" "right" "bottom" "left"))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "tooltip" {"content" content "side" side "visible" visible} child))

(define popover.metadata
  '{
     :descriptor-name "popover"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile
               {
                 :expr-props ["visible"]
                 :required-children true
                 :node-slots ["trigger"]}
             :children "any"}}})

(form (popover {:keys [trigger title description side align visible]} child ...)
  "Builds a popover with a required trigger node, optional heading and
   placement, and child nodes."
  :examples
    [[(view Example
        :layout (popover :trigger (button "Open") (text "Details")))]]
  :types
    {
      :trigger Syntax
      :title (Option (Expr a))
      :description (Option (Expr a))
      :side (Option (Union "top" "right" "bottom" "left"))
      :align (Option (Union "start" "center" "end"))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component
    "popover"
    {
      "trigger" trigger
      "title" title
      "description" description
      "side" side
      "align" align
      "visible" visible}
    child))

(define hover-card.metadata
  '{
     :descriptor-name "hover-card"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile
               {
                 :expr-props ["visible"]
                 :required-children true
                 :node-slots ["trigger"]}
             :children "any"}}})

(form (hover-card {:keys [trigger side align visible]} child ...)
  "Builds a hover-card with a required trigger node, optional placement, and
   child nodes."
  :examples
    [[(view Example
        :layout (hover-card :trigger (text "More") (text "Details")))]]
  :types
    {
      :trigger Syntax
      :side (Option (Union "top" "right" "bottom" "left"))
      :align (Option (Union "start" "center" "end"))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component
    "hover-card"
    {"trigger" trigger "side" side "align" align "visible" visible}
    child))

(define dialog.metadata
  '{
     :descriptor-name "dialog"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"] :required-children true}
             :children "any"
             :events {:on-open-change "onOpenChange"}}}})

(form (dialog {:keys [dialog-id title description visible]} child ...)
  "Builds a dialog identified by a string, with optional title and
   description expressions and child nodes."
  :examples
    [[(view Example
        :layout (dialog :dialog-id "confirm" :title "Confirm" (button "OK")))]]
  :types
    {
      :dialog-id String
      :title (Option (Expr a))
      :description (Option (Expr a))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component
    "dialog"
    {
      "dialog-id" dialog-id
      "title" title
      "description" description
      "visible" visible}
    child))

; =============================================================================
; SECTION 5 — DATA DISPLAYS
; =============================================================================
(define table.metadata
  '{
     :descriptor-name "table"
     :extensions
       {
         :view/component
           {
             :allows-bind true
             :compile
               {
                 :expr-props ["visible" "bind"]
                 :required-bind true
                 :slot-normalize-kinds
                   {
                     :columns "table-columns"
                     :filters "table-filters"
                     :default-sort "table-sort"}
                 :slot-types
                   {
                     :columns {:kind "array" :item ["string" "ViewTableColumn"]}
                     :filters {:kind "array" :item ["string" "ViewTableFilter"]}
                     :default-sort "ViewTableSort"}}
             :children "none"
             :events {:on-row-click "onRowClick"}}}})

(form
  (table
    {:keys [columns filters page-size default-sort empty-state visible bind]})
  "Builds a table configuration node with optional columns, filters, paging,
   sorting, empty state, and binding."
  :examples
    [[(view Example
        :state {:items []}
        :layout (table :bind $state.items :columns ["name"]))]]
  :types
    {
      :columns (Option Json)
      :filters (Option Json)
      :page-size (Option Float)
      :default-sort (Option Json)
      :empty-state (Option String)
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))}
  :ir ComponentIR
  (component
    "table"
    {
      "columns" columns
      "filters" filters
      "page-size" page-size
      "default-sort" default-sort
      "empty-state" empty-state
      "visible" visible
      "bind" bind}
    []))

(define tree.metadata
  '{
     :descriptor-name "tree"
     :extensions
       {
         :view/component
           {
             :allows-bind true
             :compile
               {
                 :expr-props ["visible" "bind"]
                 :slot-normalize-kinds {:default-expanded "boolean-or-number"}
                 :slot-types {:default-expanded ["boolean" "number"]}}
             :children "any"
             :events {:on-node-click "onNodeClick"}}}})

(form
  (tree
    {:keys [id-key parent-id-key label-key default-expanded visible bind]}
    child
    ...)
  "Builds a tree configuration with optional identifier, parent, and label
   keys, expansion data, binding, and child nodes."
  :examples
    [[(view Example
        :state {:items []}
        :layout (tree :bind $state.items :id-key "id" :label-key "name"))]]
  :types
    {
      :id-key (Option String)
      :parent-id-key (Option String)
      :label-key (Option String)
      :default-expanded (Option Json)
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))
      :child (List component)}
  :ir ComponentIR
  (component
    "tree"
    {
      "id-key" id-key
      "parent-id-key" parent-id-key
      "label-key" label-key
      "default-expanded" default-expanded
      "visible" visible
      "bind" bind}
    child))

(define metric.metadata
  '{
     :descriptor-name "metric"
     :extensions
       {
         :view/component
           {
             :allows-bind true
             :compile
               {
                 :expr-props ["visible" "bind"]
                 :required-bind true
                 :slot-normalize-kinds {:series "chart-series"}}
             :children "none"}}})

(form (metric {:keys [label value value-key visible bind]})
  "Builds a metric node with optional label, value expression, value key,
   and binding."
  :examples
    [[(view Example
        :state {:value 7}
        :layout (metric :bind $state.value :label "Count"))]]
  :types
    {
      :label (Option (Expr a))
      :value (Option (Expr a))
      :value-key (Option String)
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))}
  :ir ComponentIR
  (component
    "metric"
    {
      "label" label
      "value" value
      "value-key" value-key
      "visible" visible
      "bind" bind}
    []))

(define chart.metadata
  '{
     :descriptor-name "chart"
     :extensions
       {
         :view/component
           {
             :allows-bind true
             :compile
               {
                 :expr-props ["visible" "bind"]
                 :slot-types
                   {:series {:kind "array" :item ["string" "ViewChartSeries"]}}}
             :children "none"}}})

(form (chart {:keys [title chart-type category-key series visible bind]})
  "Builds a chart configuration with optional chart type, category key,
   series data, title, and binding."
  :examples
    [[(view Example
        :state {:items []}
        :layout
          (chart :chart-type "bar" :bind $state.items :category-key "name"))]]
  :types
    {
      :title (Option (Expr a))
      :chart-type
        (Option (Union "bar" "line" "area" "pie" "radar" "radial" "scatter"))
      :category-key (Option String)
      :series (Option Json)
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))}
  :ir ComponentIR
  (component
    "chart"
    {
      "title" title
      "chart-type" chart-type
      "category-key" category-key
      "series" series
      "visible" visible
      "bind" bind}
    []))

; =============================================================================
; SECTION 6 — TEXT AND STATISTICS
; =============================================================================
(define markdown.metadata
  '{
     :descriptor-name "markdown"
     :extensions
       {
         :view/component
           {
             :allows-bind true
             :compile {:expr-props ["visible" "bind"]}
             :children "none"
             :positional-prop "content"}}})

(form (markdown content {:keys [visible bind]})
  "Builds a Markdown configuration node from content or a binding
   expression; it accepts no children."
  :examples
    [[(view Example :layout (markdown "# Hello"))]]
  :types
    {
      :content (Option (Expr a))
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))}
  :ir ComponentIR
  (component "markdown" {"content" content "visible" visible "bind" bind} []))

(define stat-group.metadata
  '{
     :descriptor-name "stat-group"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"] :required-children true}
             :children "any"}}})

(form (stat-group {:keys [gap visible]} child ...)
  "Groups statistic nodes with optional gap and visibility configuration."
  :examples
    [[(view Example
        :state {:value 7}
        :layout (stat-group (metric :bind $state.value :label "Count")))]]
  :types
    {:gap (Option Float) :visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "stat-group" {"gap" gap "visible" visible} child))

(define heading.metadata
  '{
     :descriptor-name "heading"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "none"
             :positional-prop "text"}}})

(form (heading text {:keys [level visible]})
  "Builds a heading node from a text expression and optional numeric level."
  :examples
    [[(view Example :layout (heading "Overview" :level 2))]]
  :types
    {
      :text (Option (Expr a))
      :level (Option Float)
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "heading" {"text" text "level" level "visible" visible} []))

(define divider.metadata
  '{
     :descriptor-name "divider"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "none"}}})

(form (divider {:keys [visible]})
  "Builds a divider node with optional visibility."
  :examples
    [[(view Example :layout (divider))]]
  :types {:visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "divider" {"visible" visible} []))

(define alert.metadata
  '{
     :descriptor-name "alert"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile
               {:expr-props ["visible"] :slot-defaults {:message "empty-expr"}}
             :children "none"
             :positional-prop "message"}}})

(form (alert message {:keys [variant visible]})
  "Builds an alert configuration node with a required message expression and
   optional variant and visibility."
  :examples
    [[(view Example :layout (alert "Check your details" :variant "warning"))]]
  :types
    {
      :message (Expr a)
      :variant (Option (Union "default" "warning" "error" "info"))
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "alert" {"message" message "variant" variant "visible" visible} []))

; =============================================================================
; SECTION 7 — FORMS AND NAVIGATION
; =============================================================================
(define form.metadata
  '{
     :descriptor-name "form"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"] :required-children true}
             :children "any"
             :events {:on-submit "onSubmit"}}}})

(form (form {:keys [title description visible]} child ...)
  "Builds a UI form container with optional title and description
   expressions and child nodes."
  :examples
    [[(view Example :layout (form :title "Profile" (input :name "name")))]]
  :types
    {
      :title (Option (Expr a))
      :description (Option (Expr a))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component
    "form"
    {"title" title "description" description "visible" visible}
    child))

(define button-group.metadata
  '{
     :descriptor-name "button-group"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"] :required-children true}
             :children "any"}}})

(form (button-group {:keys [orientation visible]} child ...)
  "Groups button nodes with optional orientation."
  :examples
    [[(view Example :layout (button-group (button "Save") (button "Cancel")))]]
  :types
    {
      :orientation (Option (Union "horizontal" "vertical"))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "button-group" {"orientation" orientation "visible" visible} child))

(define breadcrumb.metadata
  '{
     :descriptor-name "breadcrumb"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"] :required-children true}
             :children ["only" ["breadcrumb-item"]]}}})

(form (breadcrumb {:keys [visible]} child ...)
  "Builds a breadcrumb container restricted to breadcrumb-item children."
  :examples
    [[(view Example
        :layout (breadcrumb (breadcrumb-item :label "Home" :href "/")))]]
  :types {:visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "breadcrumb" {"visible" visible} child))

(define breadcrumb-item.metadata
  '{
     :descriptor-name "breadcrumb-item"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "none"
             :parents ["breadcrumb"]
             :events {:on-click "onClick"}}}})

(form (breadcrumb-item {:keys [label href current visible]})
  "Builds a breadcrumb entry with a required label expression and optional
   link and current-item marker."
  :examples
    [[(view Example
        :layout (breadcrumb (breadcrumb-item :label "Home" :href "/")))]]
  :types
    {
      :label (Expr a)
      :href (Option (Expr a))
      :current (Option Json)
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component
    "breadcrumb-item"
    {"label" label "href" href "current" current "visible" visible}
    []))

; =============================================================================
; SECTION 8 — INPUT CONTROLS
; =============================================================================
(define input.metadata
  '{
     :descriptor-name "input"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "none"
             :events {:on-change "onChange"}}}})

(form
  (input
    {
      :keys
        [
          name
          default-value
          label
          description
          placeholder
          input-type
          prefix
          suffix
          visible]})
  "Builds a named input configuration with optional default value, label,
   description, placeholder, input type, prefix, and suffix."
  :examples
    [[(view Example
        :layout (input :name "email" :label "Email" :input-type "email"))]]
  :types
    {
      :name String
      :default-value (Option (Expr a))
      :label (Option (Expr a))
      :description (Option (Expr a))
      :placeholder (Option String)
      :input-type
        (Option (Union "text" "email" "password" "number" "url" "date"))
      :prefix (Option String)
      :suffix (Option String)
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component
    "input"
    {
      "name" name
      "default-value" default-value
      "label" label
      "description" description
      "placeholder" placeholder
      "input-type" input-type
      "prefix" prefix
      "suffix" suffix
      "visible" visible}
    []))

(define textarea.metadata
  '{
     :descriptor-name "textarea"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "none"
             :events {:on-change "onChange"}}}})

(form
  (textarea {:keys [name default-value label description placeholder visible]})
  "Builds a named multiline input configuration with optional default value,
   label, description, and placeholder."
  :examples
    [[(view Example :layout (textarea :name "notes" :label "Notes"))]]
  :types
    {
      :name String
      :default-value (Option (Expr a))
      :label (Option (Expr a))
      :description (Option (Expr a))
      :placeholder (Option String)
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component
    "textarea"
    {
      "name" name
      "default-value" default-value
      "label" label
      "description" description
      "placeholder" placeholder
      "visible" visible}
    []))

(define checkbox.metadata
  '{
     :descriptor-name "checkbox"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "none"
             :events {:on-change "onChange"}}}})

(form (checkbox {:keys [name default-value label description visible]})
  "Builds a named checkbox configuration with optional default value, label,
   and description expressions."
  :examples
    [[(view Example
        :layout (checkbox :name "active" :label "Active" :default-value true))]]
  :types
    {
      :name String
      :default-value (Option (Expr a))
      :label (Option (Expr a))
      :description (Option (Expr a))
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component
    "checkbox"
    {
      "name" name
      "default-value" default-value
      "label" label
      "description" description
      "visible" visible}
    []))

(define switch.metadata
  '{
     :descriptor-name "switch"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "none"
             :events {:on-change "onChange"}}}})

(form (switch {:keys [name default-value label description visible]})
  "Builds a named switch configuration with optional default value, label,
   and description expressions."
  :examples
    [[(view Example :layout (switch :name "enabled" :label "Enabled"))]]
  :types
    {
      :name String
      :default-value (Option (Expr a))
      :label (Option (Expr a))
      :description (Option (Expr a))
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component
    "switch"
    {
      "name" name
      "default-value" default-value
      "label" label
      "description" description
      "visible" visible}
    []))

(define select.metadata
  '{
     :descriptor-name "select"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile
               {
                 :expr-props ["visible"]
                 :slot-normalize-kinds {:options "select-options"}
                 :slot-types
                   {
                     :options
                       {:kind "array" :item ["string" "ViewSelectOptionValue"]}}}
             :children ["only" ["select-option"]]
             :events {:on-change "onChange"}}}})

(form
  (select
    {:keys [name default-value label description placeholder options visible]}
    child
    ...)
  "Builds a named select configuration with optional JSON options or
   select-option children."
  :examples
    [[(view Example
        :layout
          (select :name "color" (select-option :value "blue" :label "Blue")))]]
  :types
    {
      :name String
      :default-value (Option (Expr a))
      :label (Option (Expr a))
      :description (Option (Expr a))
      :placeholder (Option String)
      :options (Option Json)
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component
    "select"
    {
      "name" name
      "default-value" default-value
      "label" label
      "description" description
      "placeholder" placeholder
      "options" options
      "visible" visible}
    child))

(define select-option.metadata
  '{
     :descriptor-name "select-option"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile
               {
                 :expr-props ["visible"]
                 :extra-normalize-fields
                   [
                     {
                       :field "label"
                       :keys ["label" "text" "value"]
                       :kind "expr"}]}
             :children "none"
             :parents ["select"]}}})

(form (select-option {:keys [value label visible]})
  "Builds a string-valued option with an optional label expression, inside
   select."
  :examples
    [[(view Example
        :layout
          (select :name "color" (select-option :value "blue" :label "Blue")))]]
  :types {:value String :label (Option (Expr a)) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "select-option" {"value" value "label" label "visible" visible} []))

(define radio-group.metadata
  '{
     :descriptor-name "radio-group"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile
               {
                 :expr-props ["visible"]
                 :slot-normalize-kinds {:options "select-options"}
                 :slot-types
                   {
                     :options
                       {:kind "array" :item ["string" "ViewSelectOptionValue"]}}}
             :children ["only" ["radio-option"]]
             :events {:on-change "onChange"}}}})

(form
  (radio-group
    {:keys [name default-value label description options visible]}
    child
    ...)
  "Builds a named radio-group configuration with optional JSON options or
   radio-option children."
  :examples
    [[(view Example
        :layout
          (radio-group
            :name "color"
            (radio-option :value "blue" :label "Blue")))]]
  :types
    {
      :name String
      :default-value (Option (Expr a))
      :label (Option (Expr a))
      :description (Option (Expr a))
      :options (Option Json)
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component
    "radio-group"
    {
      "name" name
      "default-value" default-value
      "label" label
      "description" description
      "options" options
      "visible" visible}
    child))

(define radio-option.metadata
  '{
     :descriptor-name "radio-option"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile
               {
                 :expr-props ["visible"]
                 :extra-normalize-fields
                   [
                     {
                       :field "label"
                       :keys ["label" "text" "value"]
                       :kind "expr"}]}
             :children "none"
             :parents ["radio-group"]}}})

(form (radio-option {:keys [value label visible]})
  "Builds a string-valued option with an optional label expression, inside
   radio-group."
  :examples
    [[(view Example
        :layout
          (radio-group
            :name "color"
            (radio-option :value "blue" :label "Blue")))]]
  :types {:value String :label (Option (Expr a)) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "radio-option" {"value" value "label" label "visible" visible} []))

(define slider.metadata
  '{
     :descriptor-name "slider"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile
               {
                 :expr-props ["visible"]
                 :slot-normalize-kinds {:options "select-options"}}
             :children "none"
             :events {:on-change "onChange"}}}})

(form
  (slider {:keys [name default-value label description min max step visible]})
  "Builds a named slider configuration with optional default value, numeric
   minimum, maximum, and step."
  :examples
    [[(view Example :layout (slider :name "volume" :min 0 :max 100 :step 1))]]
  :types
    {
      :name String
      :default-value (Option (Expr a))
      :label (Option (Expr a))
      :description (Option (Expr a))
      :min (Option Float)
      :max (Option Float)
      :step (Option Float)
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component
    "slider"
    {
      "name" name
      "default-value" default-value
      "label" label
      "description" description
      "min" min
      "max" max
      "step" step
      "visible" visible}
    []))

(define toggle-group.metadata
  '{
     :descriptor-name "toggle-group"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile
               {
                 :expr-props ["visible"]
                 :slot-types
                   {
                     :options
                       {:kind "array" :item ["string" "ViewSelectOptionValue"]}}}
             :children "none"
             :events {:on-change "onChange"}}}})

(form (toggle-group {:keys [name default-value mode variant options visible]})
  "Builds a named toggle-group configuration with optional default value,
   mode, variant, and JSON options."
  :examples
    [[(view Example
        :layout
          (toggle-group
            :name "mode"
            :mode "single"
            :options ["compact" "full"]))]]
  :types
    {
      :name String
      :default-value (Option (Expr a))
      :mode (Option (Union "single" "multiple"))
      :variant (Option (Union "default" "outline"))
      :options (Option Json)
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component
    "toggle-group"
    {
      "name" name
      "default-value" default-value
      "mode" mode
      "variant" variant
      "options" options
      "visible" visible}
    []))

; =============================================================================
; SECTION 9 — PLACEHOLDERS AND HOST CONTENT
; =============================================================================
(define skeleton.metadata
  '{
     :descriptor-name "skeleton"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "none"}}})

(form (skeleton {:keys [lines visible]})
  "Builds a skeleton configuration node with an optional line count."
  :examples
    [[(view Example :layout (skeleton :lines 3))]]
  :types {:lines (Option Float) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "skeleton" {"lines" lines "visible" visible} []))

(define raw-html.metadata
  '{
     :descriptor-name "raw-html"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "none"
             :positional-prop "content"}}})

(form (raw-html content {:keys [visible]})
  "Captures a required content expression in a raw-html configuration node;
   interpretation belongs to the host."
  :examples
    [[(view Example :layout (raw-html "<strong>Hello</strong>"))]]
  :types {:content (Expr a) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "raw-html" {"content" content "visible" visible} []))

(define raw-css.metadata
  '{
     :descriptor-name "raw-css"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "none"
             :positional-prop "content"}}})

(form (raw-css content {:keys [visible]})
  "Captures a required content expression in a raw-css configuration node;
   interpretation belongs to the host."
  :examples
    [[(view Example :layout (raw-css "body { color: navy; }"))]]
  :types {:content (Expr a) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "raw-css" {"content" content "visible" visible} []))

(define raw-js.metadata
  '{
     :descriptor-name "raw-js"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "none"
             :positional-prop "code"}}})

(form (raw-js code {:keys [visible]})
  "Captures a required code expression in a raw-js configuration node;
   execution belongs to the host."
  :examples
    [[(view Example :layout (raw-js "console.log('hello')"))]]
  :types {:code (Expr a) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "raw-js" {"code" code "visible" visible} []))

(define custom.metadata
  '{
     :descriptor-name "custom"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile
               {
                 :expr-props ["visible"]
                 :json-slots ["props"]
                 :unknown-props "json"
                 :slot-types {:props {:kind "record" :value "unknown"}}}
             :children "any"}}})

(form (custom {:keys [component-name props visible]} child ...)
  "Builds a host component configuration by string name, with optional JSON
   properties and child nodes."
  :examples
    [[(view Example
        :layout
          (custom
            :component-name "host/greeting"
            :props {:message "Hello"}
            (text "Fallback")))]]
  :types
    {
      :component-name String
      :props (Option Json)
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component
    "custom"
    {"component-name" component-name "props" props "visible" visible}
    child))

; =============================================================================
; SECTION 10 — LAYOUT ALIASES
; =============================================================================
; Layout alias for use; this is constant host metadata rather than a callable
; form.
(define component-ref
  '{:extensions {:view/layout-alias {:form "component-ref" :to "view-ref"}}})

; Layout alias for condition; distinct from the kernel cond macro.
(define cond '{:extensions {:view/layout-alias {:form "cond" :to "condition"}}})
