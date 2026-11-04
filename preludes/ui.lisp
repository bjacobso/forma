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

(form (text content {:keys [visible bind]})
  "Builds a text configuration node from content or a binding expression; it
   accepts no children."
  :examples
    [[(view Example :layout (text "Hello"))]]
  :extensions
    {
      :view/component
        {
          :allows-bind true
          :compile {:expr-props ["visible" "bind"]}
          :children "none"
          :positional-prop "content"}}
  :types
    {
      :content (Option (Expr a))
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))}
  :ir ComponentIR
  (component "text" (named-map content visible bind) []))

(form (rows {:keys [gap visible]} child ...)
  "Builds a rows container with optional gap and visibility; hosted layouts
   require children."
  :examples
    [[(view Example :layout (rows :gap 8 (text "First") (text "Second")))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"] :required-children true}
          :children "any"}}
  :types
    {:gap (Option Float) :visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "rows" (named-map gap visible) child))

(form (columns {:keys [gap visible]} child ...)
  "Builds a columns container with optional gap and visibility; hosted
   layouts require children."
  :examples
    [[(view Example :layout (columns :gap 12 (text "Left") (text "Right")))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"] :required-children true}
          :children "any"}}
  :types
    {:gap (Option Float) :visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "columns" (named-map gap visible) child))

(form
  (card
    {:keys [title description subject-mode action footer visible]}
    child
    ...)
  "Builds a card container with title and description expressions and
   optional action and footer nodes."
  :examples
    [[(view Example :layout (card :title "Profile" (text "Ada")))]]
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
          :children "any"}}
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
  (component "card"
    (named-map title description subject-mode action footer visible)
    child))

(form (item-group {:keys [visible bind]} child ...)
  "Groups item nodes, optionally binding the group to an expression."
  :examples
    [[(view Example :layout (item-group (item :title "Compiler")))]]
  :extensions
    {
      :view/component
        {
          :allows-bind true
          :compile {:expr-props ["visible" "bind"] :required-children true}
          :children "any"}}
  :types
    {
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))
      :child (List component)}
  :ir ComponentIR
  (component "item-group" (named-map visible bind) child))

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
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"]}
          :children "any"
          :events {:on-click "onClick"}}}
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
  (component "item"
    (named-map variant size icon title description value badge badge-variant
               visible)
    child))

(form
  (button label {:keys [variant size disabled button-type visible]} child ...)
  "Builds a button node with a label expression, variant, size, disabled
   expression, and optional children."
  :examples
    [[(view Example :layout (button "Save" :variant "default"))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible" "disabled"]}
          :children "any"
          :events {:on-click "onClick"}
          :positional-prop "label"}}
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
  (component "button"
    (named-map label variant size disabled button-type visible)
    child))

(form (progress {:keys [value label hint visible bind]})
  "Builds a progress node with value, label, and hint expressions or a
   binding."
  :examples
    [[(view Example :layout (progress :value 50 :label "Halfway"))]]
  :extensions
    {
      :view/component
        {
          :allows-bind true
          :compile {:expr-props ["visible" "bind"]}
          :children "none"}}
  :types
    {
      :value (Option (Expr a))
      :label (Option (Expr a))
      :hint (Option (Expr a))
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))}
  :ir ComponentIR
  (component "progress" (named-map value label hint visible bind) []))

(form (workflow-strip {:keys [title description visible]} child ...)
  "Groups workflow-step nodes under optional title and description
   expressions."
  :examples
    [[(view Example :layout (workflow-strip (workflow-step :label "Review")))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :children ["only" ["workflow-step"]]
          :compile {:required-children true}}}
  :types
    {
      :title (Option (Expr a))
      :description (Option (Expr a))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "workflow-strip" (named-map title description visible) child))

(form (workflow-step {:keys [label description status icon visible]})
  "Builds one workflow step with a required label expression and optional
   description, status, and icon."
  :examples
    [[(view Example
        :layout
          (workflow-strip (workflow-step :label "Review" :status "pending")))]]
  :extensions
    {
      :view/component
        {:allows-bind false :children "none" :parents ["workflow-strip"]}}
  :types
    {
      :label (Expr a)
      :description (Option (Expr a))
      :status (Option (Expr a))
      :icon (Option String)
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "workflow-step"
    (named-map label description status icon visible)
    []))

(form (empty-state {:keys [icon title description visible]} child ...)
  "Builds an empty-state container with optional icon, title, description,
   and child nodes."
  :examples
    [[(view Example
        :layout (empty-state :title "No records" (button "Create")))]]
  :extensions
    {
      :view/component
        {:allows-bind false :compile {:expr-props ["visible"]} :children "any"}}
  :types
    {
      :icon (Option String)
      :title (Option (Expr a))
      :description (Option (Expr a))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "empty-state" (named-map icon title description visible) child))

(form (badge content {:keys [variant dot dot-color visible]})
  "Builds a badge node from a content expression and optional variant and
   dot configuration."
  :examples
    [[(view Example :layout (badge "Ready" :variant "secondary"))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"]}
          :children "none"
          :positional-prop "content"}}
  :types
    {
      :content (Option (Expr a))
      :variant (Option (Union "default" "secondary" "outline" "destructive"))
      :dot (Option Json)
      :dot-color (Option String)
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "badge" (named-map content variant dot dot-color visible) []))

(form (avatar {:keys [src alt fallback size visible]})
  "Builds an avatar node with source, alternative text, fallback
   expressions, and optional size."
  :examples
    [[(view Example :layout (avatar :fallback "AJ" :alt "Ada"))]]
  :extensions
    {
      :view/component
        {:allows-bind false :compile {:expr-props ["visible"]} :children "none"}}
  :types
    {
      :src (Option (Expr a))
      :alt (Option (Expr a))
      :fallback (Option (Expr a))
      :size (Option (Union "default" "sm" "lg"))
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "avatar" (named-map src alt fallback size visible) []))

(form (kbd content {:keys [visible]})
  "Builds a keyboard-hint node from a content expression."
  :examples
    [[(view Example :layout (kbd "Enter"))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"]}
          :children "none"
          :positional-prop "content"}}
  :types {:content (Option (Expr a)) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "kbd" (named-map content visible) []))

(form (spinner {:keys [label size visible]})
  "Builds a spinner node with an optional label expression and size."
  :examples
    [[(view Example :layout (spinner :label "Loading"))]]
  :extensions
    {
      :view/component
        {:allows-bind false :compile {:expr-props ["visible"]} :children "none"}}
  :types
    {
      :label (Option (Expr a))
      :size (Option (Union "sm" "default" "lg"))
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "spinner" (named-map label size visible) []))

(form (separator {:keys [orientation visible]})
  "Builds a separator node with optional horizontal or vertical orientation."
  :examples
    [[(view Example :layout (separator :orientation "vertical"))]]
  :extensions
    {
      :view/component
        {:allows-bind false :compile {:expr-props ["visible"]} :children "none"}}
  :types
    {
      :orientation (Option (Union "horizontal" "vertical"))
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "separator" (named-map orientation visible) []))

; =============================================================================
; SECTION 3 — COMPOSED LAYOUTS AND BRANCHES
; =============================================================================

(form (tabs {:keys [visible]} child ...)
  "Builds a container whose children must be tab-panel nodes."
  :examples
    [[(view Example
        :layout (tabs (tab-panel :label "Overview" (text "Hello"))))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"] :required-children true}
          :children ["only" ["tab-panel"]]}}
  :types {:visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "tabs" (named-map visible) child))

(form (tab-panel {:keys [label visible]} child ...)
  "Builds a labeled panel that belongs inside tabs and contains child nodes."
  :examples
    [[(view Example
        :layout (tabs (tab-panel :label "Overview" (text "Hello"))))]]
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
          :parents ["tabs"]}}
  :types
    {
      :label (Option (Expr a))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "tab-panel" (named-map label visible) child))

(form (accordion {:keys [mode visible]} child ...)
  "Builds an accordion of accordion-item children, with single or multiple
   expansion mode."
  :examples
    [[(view Example
        :layout
          (accordion
            :mode "single"
            (accordion-item :title "Details" (text "Hello"))))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"] :required-children true}
          :children ["only" ["accordion-item"]]}}
  :types
    {
      :mode (Option (Union "single" "multiple"))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "accordion" (named-map mode visible) child))

(form (accordion-item {:keys [title default-open visible]} child ...)
  "Builds an accordion section with optional title and default-open
   configuration and nested content."
  :examples
    [[(view Example
        :layout (accordion (accordion-item :title "Details" (text "Hello"))))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"] :required-children true}
          :children "any"
          :parents ["accordion"]}}
  :types
    {
      :title (Option (Expr a))
      :default-open (Option Json)
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "accordion-item" (named-map title default-open visible) child))

(form (grid {:keys [columns visible]} child ...)
  "Builds a grid container with an optional column count and child nodes."
  :examples
    [[(view Example :layout (grid :columns 2 (text "First") (text "Second")))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"] :required-children true}
          :children "any"}}
  :types
    {
      :columns (Option Float)
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "grid" (named-map columns visible) child))

(form (aspect-ratio {:keys [ratio visible]} child ...)
  "Builds a container with an optional numeric aspect ratio and child nodes."
  :examples
    [[(view Example :layout (aspect-ratio :ratio 1.5 (text "Preview")))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"] :required-children true}
          :children "any"}}
  :types
    {
      :ratio (Option Float)
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "aspect-ratio" (named-map ratio visible) child))

(form (spacer {:keys [height visible]})
  "Builds a spacer node with optional numeric height."
  :examples
    [[(view Example :layout (spacer :height 16))]]
  :extensions
    {
      :view/component
        {:allows-bind false :compile {:expr-props ["visible"]} :children "none"}}
  :types {:height (Option Float) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "spacer" (named-map height visible) []))

(form (split-pane {:keys [direction sizes visible]} child ...)
  "Builds a split-pane container with optional direction and JSON sizes
   configuration."
  :examples
    [[(view Example
        :layout
          (split-pane :direction "horizontal" (text "Left") (text "Right")))]]
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
          :children "any"}}
  :types
    {
      :direction (Option (Union "horizontal" "vertical"))
      :sizes (Option Json)
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "split-pane" (named-map direction sizes visible) child))

(form (for-each {:keys [empty-text visible bind]} child ...)
  "Builds a repeating container with a required binding in hosted layouts
   and optional empty text."
  :examples
    [[(view Example
        :state {:items []}
        :layout (for-each :bind $state.items (text "Item")))]]
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
          :children "any"}}
  :types
    {
      :empty-text (Option String)
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))
      :child (List component)}
  :ir ComponentIR
  (component "for-each" (named-map empty-text visible bind) child))

(form (condition {:keys [visible]} child ...)
  "Builds a conditional container restricted to case and else children."
  :examples
    [[(view Example
        :layout
          (condition (case :when true (text "Ready")) (else (text "Waiting"))))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"] :required-children true}
          :children ["only" ["case" "else"]]}}
  :types {:visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "condition" (named-map visible) child))

(form (case {:keys [when visible]} child ...)
  "Builds a conditional branch with a required when expression and child
   nodes, inside condition."
  :examples
    [[(view Example :layout (condition (case :when true (text "Ready"))))]]
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
          :parents ["condition"]}}
  :types {:when (Expr a) :visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "case" (named-map when visible) child))

(form (else {:keys [visible]} child ...)
  "Builds the fallback branch of a condition container."
  :examples
    [[(view Example
        :layout
          (condition
            (case :when false (text "Ready"))
            (else (text "Waiting"))))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"] :required-children true}
          :children "any"
          :parents ["condition"]}}
  :types {:visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "else" (named-map visible) child))

(form (slot name {:keys [visible bind]} child ...)
  "Builds a named or unnamed layout slot with optional binding and fallback
   child nodes."
  :examples
    [[(view Example :layout (slot "body" (text "Fallback")))]]
  :extensions
    {
      :view/component
        {
          :allows-bind true
          :compile {:expr-props ["visible" "bind"]}
          :children "any"
          :positional-prop "name"}}
  :types
    {
      :name (Option String)
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))
      :child (List component)}
  :ir ComponentIR
  (component "slot" (named-map name visible bind) child))

(form (use name {:keys [overrides visible]} child ...)
  "Refers to a reusable layout definition by string name, with optional JSON
   overrides and child nodes."
  :examples
    [[(view Example :defs {:greeting (text "Hello")} :layout (use "greeting"))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"]}
          :children "any"
          :positional-prop "name"}}
  :types
    {
      :name String
      :overrides (Option Json)
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "use" (named-map name overrides visible) child))

; =============================================================================
; SECTION 4 — OVERLAYS
; =============================================================================

(form (tooltip {:keys [content side visible]} child ...)
  "Builds a tooltip wrapper with a required content expression, optional
   side, and child nodes."
  :examples
    [[(view Example :layout (tooltip :content "Save changes" (button "Save")))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"] :required-children true}
          :children "any"}}
  :types
    {
      :content (Expr a)
      :side (Option (Union "top" "right" "bottom" "left"))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "tooltip" (named-map content side visible) child))

(form (popover {:keys [trigger title description side align visible]} child ...)
  "Builds a popover with a required trigger node, optional heading and
   placement, and child nodes."
  :examples
    [[(view Example
        :layout (popover :trigger (button "Open") (text "Details")))]]
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
          :children "any"}}
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
  (component "popover"
    (named-map trigger title description side align visible)
    child))

(form (hover-card {:keys [trigger side align visible]} child ...)
  "Builds a hover-card with a required trigger node, optional placement, and
   child nodes."
  :examples
    [[(view Example
        :layout (hover-card :trigger (text "More") (text "Details")))]]
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
          :children "any"}}
  :types
    {
      :trigger Syntax
      :side (Option (Union "top" "right" "bottom" "left"))
      :align (Option (Union "start" "center" "end"))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "hover-card" (named-map trigger side align visible) child))

(form (dialog {:keys [dialog-id title description visible]} child ...)
  "Builds a dialog identified by a string, with optional title and
   description expressions and child nodes."
  :examples
    [[(view Example
        :layout (dialog :dialog-id "confirm" :title "Confirm" (button "OK")))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"] :required-children true}
          :children "any"
          :events {:on-open-change "onOpenChange"}}}
  :types
    {
      :dialog-id String
      :title (Option (Expr a))
      :description (Option (Expr a))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "dialog" (named-map dialog-id title description visible) child))

; =============================================================================
; SECTION 5 — DATA DISPLAYS
; =============================================================================

(form
  (table
    {:keys [columns filters page-size default-sort empty-state visible bind]})
  "Builds a table configuration node with optional columns, filters, paging,
   sorting, empty state, and binding."
  :examples
    [[(view Example
        :state {:items []}
        :layout (table :bind $state.items :columns ["name"]))]]
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
          :events {:on-row-click "onRowClick"}}}
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
  (component "table"
    (named-map columns filters page-size default-sort empty-state visible bind)
    []))

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
          :events {:on-node-click "onNodeClick"}}}
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
  (component "tree"
    (named-map id-key parent-id-key label-key default-expanded visible bind)
    child))

(form (metric {:keys [label value value-key visible bind]})
  "Builds a metric node with optional label, value expression, value key,
   and binding."
  :examples
    [[(view Example
        :state {:value 7}
        :layout (metric :bind $state.value :label "Count"))]]
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
          :children "none"}}
  :types
    {
      :label (Option (Expr a))
      :value (Option (Expr a))
      :value-key (Option String)
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))}
  :ir ComponentIR
  (component "metric" (named-map label value value-key visible bind) []))

(form (chart {:keys [title chart-type category-key series visible bind]})
  "Builds a chart configuration with optional chart type, category key,
   series data, title, and binding."
  :examples
    [[(view Example
        :state {:items []}
        :layout
          (chart :chart-type "bar" :bind $state.items :category-key "name"))]]
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
          :children "none"}}
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
  (component "chart"
    (named-map title chart-type category-key series visible bind)
    []))

; =============================================================================
; SECTION 6 — TEXT AND STATISTICS
; =============================================================================

(form (markdown content {:keys [visible bind]})
  "Builds a Markdown configuration node from content or a binding
   expression; it accepts no children."
  :examples
    [[(view Example :layout (markdown "# Hello"))]]
  :extensions
    {
      :view/component
        {
          :allows-bind true
          :compile {:expr-props ["visible" "bind"]}
          :children "none"
          :positional-prop "content"}}
  :types
    {
      :content (Option (Expr a))
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))}
  :ir ComponentIR
  (component "markdown" (named-map content visible bind) []))

(form (stat-group {:keys [gap visible]} child ...)
  "Groups statistic nodes with optional gap and visibility configuration."
  :examples
    [[(view Example
        :state {:value 7}
        :layout (stat-group (metric :bind $state.value :label "Count")))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"] :required-children true}
          :children "any"}}
  :types
    {:gap (Option Float) :visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "stat-group" (named-map gap visible) child))

(form (heading text {:keys [level visible]})
  "Builds a heading node from a text expression and optional numeric level."
  :examples
    [[(view Example :layout (heading "Overview" :level 2))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"]}
          :children "none"
          :positional-prop "text"}}
  :types
    {
      :text (Option (Expr a))
      :level (Option Float)
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "heading" (named-map text level visible) []))

(form (divider {:keys [visible]})
  "Builds a divider node with optional visibility."
  :examples
    [[(view Example :layout (divider))]]
  :extensions
    {
      :view/component
        {:allows-bind false :compile {:expr-props ["visible"]} :children "none"}}
  :types {:visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "divider" (named-map visible) []))

(form (alert message {:keys [variant visible]})
  "Builds an alert configuration node with a required message expression and
   optional variant and visibility."
  :examples
    [[(view Example :layout (alert "Check your details" :variant "warning"))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile
            {:expr-props ["visible"] :slot-defaults {:message "empty-expr"}}
          :children "none"
          :positional-prop "message"}}
  :types
    {
      :message (Expr a)
      :variant (Option (Union "default" "warning" "error" "info"))
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "alert" (named-map message variant visible) []))

; =============================================================================
; SECTION 7 — FORMS AND NAVIGATION
; =============================================================================

(form (form {:keys [title description visible]} child ...)
  "Builds a UI form container with optional title and description
   expressions and child nodes."
  :examples
    [[(view Example :layout (form :title "Profile" (input :name "name")))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"] :required-children true}
          :children "any"
          :events {:on-submit "onSubmit"}}}
  :types
    {
      :title (Option (Expr a))
      :description (Option (Expr a))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "form" (named-map title description visible) child))

(form (button-group {:keys [orientation visible]} child ...)
  "Groups button nodes with optional orientation."
  :examples
    [[(view Example :layout (button-group (button "Save") (button "Cancel")))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"] :required-children true}
          :children "any"}}
  :types
    {
      :orientation (Option (Union "horizontal" "vertical"))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "button-group" (named-map orientation visible) child))

(form (breadcrumb {:keys [visible]} child ...)
  "Builds a breadcrumb container restricted to breadcrumb-item children."
  :examples
    [[(view Example
        :layout (breadcrumb (breadcrumb-item :label "Home" :href "/")))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"] :required-children true}
          :children ["only" ["breadcrumb-item"]]}}
  :types {:visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "breadcrumb" (named-map visible) child))

(form (breadcrumb-item {:keys [label href current visible]})
  "Builds a breadcrumb entry with a required label expression and optional
   link and current-item marker."
  :examples
    [[(view Example
        :layout (breadcrumb (breadcrumb-item :label "Home" :href "/")))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"]}
          :children "none"
          :parents ["breadcrumb"]
          :events {:on-click "onClick"}}}
  :types
    {
      :label (Expr a)
      :href (Option (Expr a))
      :current (Option Json)
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "breadcrumb-item" (named-map label href current visible) []))

; =============================================================================
; SECTION 8 — INPUT CONTROLS
; =============================================================================

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
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"]}
          :children "none"
          :events {:on-change "onChange"}}}
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
  (component "input"
    (named-map name default-value label description placeholder input-type
               prefix suffix visible)
    []))

(form
  (textarea {:keys [name default-value label description placeholder visible]})
  "Builds a named multiline input configuration with optional default value,
   label, description, and placeholder."
  :examples
    [[(view Example :layout (textarea :name "notes" :label "Notes"))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"]}
          :children "none"
          :events {:on-change "onChange"}}}
  :types
    {
      :name String
      :default-value (Option (Expr a))
      :label (Option (Expr a))
      :description (Option (Expr a))
      :placeholder (Option String)
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "textarea"
    (named-map name default-value label description placeholder visible)
    []))

(form (checkbox {:keys [name default-value label description visible]})
  "Builds a named checkbox configuration with optional default value, label,
   and description expressions."
  :examples
    [[(view Example
        :layout (checkbox :name "active" :label "Active" :default-value true))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"]}
          :children "none"
          :events {:on-change "onChange"}}}
  :types
    {
      :name String
      :default-value (Option (Expr a))
      :label (Option (Expr a))
      :description (Option (Expr a))
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "checkbox"
    (named-map name default-value label description visible)
    []))

(form (switch {:keys [name default-value label description visible]})
  "Builds a named switch configuration with optional default value, label,
   and description expressions."
  :examples
    [[(view Example :layout (switch :name "enabled" :label "Enabled"))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"]}
          :children "none"
          :events {:on-change "onChange"}}}
  :types
    {
      :name String
      :default-value (Option (Expr a))
      :label (Option (Expr a))
      :description (Option (Expr a))
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "switch"
    (named-map name default-value label description visible)
    []))

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
          :events {:on-change "onChange"}}}
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
  (component "select"
    (named-map name default-value label description placeholder options visible)
    child))

(form (select-option {:keys [value label visible]})
  "Builds a string-valued option with an optional label expression, inside
   select."
  :examples
    [[(view Example
        :layout
          (select :name "color" (select-option :value "blue" :label "Blue")))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile
            {
              :expr-props ["visible"]
              :extra-normalize-fields
                [{:field "label" :keys ["label" "text" "value"] :kind "expr"}]}
          :children "none"
          :parents ["select"]}}
  :types {:value String :label (Option (Expr a)) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "select-option" (named-map value label visible) []))

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
          :events {:on-change "onChange"}}}
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
  (component "radio-group"
    (named-map name default-value label description options visible)
    child))

(form (radio-option {:keys [value label visible]})
  "Builds a string-valued option with an optional label expression, inside
   radio-group."
  :examples
    [[(view Example
        :layout
          (radio-group
            :name "color"
            (radio-option :value "blue" :label "Blue")))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile
            {
              :expr-props ["visible"]
              :extra-normalize-fields
                [{:field "label" :keys ["label" "text" "value"] :kind "expr"}]}
          :children "none"
          :parents ["radio-group"]}}
  :types {:value String :label (Option (Expr a)) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "radio-option" (named-map value label visible) []))

(form
  (slider {:keys [name default-value label description min max step visible]})
  "Builds a named slider configuration with optional default value, numeric
   minimum, maximum, and step."
  :examples
    [[(view Example :layout (slider :name "volume" :min 0 :max 100 :step 1))]]
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
          :events {:on-change "onChange"}}}
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
  (component "slider"
    (named-map name default-value label description min max step visible)
    []))

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
          :events {:on-change "onChange"}}}
  :types
    {
      :name String
      :default-value (Option (Expr a))
      :mode (Option (Union "single" "multiple"))
      :variant (Option (Union "default" "outline"))
      :options (Option Json)
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "toggle-group"
    (named-map name default-value mode variant options visible)
    []))

; =============================================================================
; SECTION 9 — PLACEHOLDERS AND HOST CONTENT
; =============================================================================

(form (skeleton {:keys [lines visible]})
  "Builds a skeleton configuration node with an optional line count."
  :examples
    [[(view Example :layout (skeleton :lines 3))]]
  :extensions
    {
      :view/component
        {:allows-bind false :compile {:expr-props ["visible"]} :children "none"}}
  :types {:lines (Option Float) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "skeleton" (named-map lines visible) []))

(form (raw-html content {:keys [visible]})
  "Captures a required content expression in a raw-html configuration node;
   interpretation belongs to the host."
  :examples
    [[(view Example :layout (raw-html "<strong>Hello</strong>"))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"]}
          :children "none"
          :positional-prop "content"}}
  :types {:content (Expr a) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "raw-html" (named-map content visible) []))

(form (raw-css content {:keys [visible]})
  "Captures a required content expression in a raw-css configuration node;
   interpretation belongs to the host."
  :examples
    [[(view Example :layout (raw-css "body { color: navy; }"))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"]}
          :children "none"
          :positional-prop "content"}}
  :types {:content (Expr a) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "raw-css" (named-map content visible) []))

(form (raw-js code {:keys [visible]})
  "Captures a required code expression in a raw-js configuration node;
   execution belongs to the host."
  :examples
    [[(view Example :layout (raw-js "console.log('hello')"))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"]}
          :children "none"
          :positional-prop "code"}}
  :types {:code (Expr a) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "raw-js" (named-map code visible) []))

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
          :children "any"}}
  :types
    {
      :component-name String
      :props (Option Json)
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "custom" (named-map component-name props visible) child))

; =============================================================================
; SECTION 10 — LAYOUT ALIASES
; =============================================================================
; Layout alias for use; this is constant host metadata rather than a callable
; form.
(define component-ref
  '{:extensions {:view/layout-alias {:form "component-ref" :to "view-ref"}}})

; Layout alias for condition; distinct from the kernel cond macro.
(define cond '{:extensions {:view/layout-alias {:form "cond" :to "condition"}}})
