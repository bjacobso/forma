; UI forms: typed projections and constant renderer configuration.
(type ComponentIR {:component String :props Json :children (List Json)})
(type component ComponentIR)
(define
  component
  [name props children]
  {:component name :props props :children children})

; ui.lisp
; -----------------------------------------------------------------------------
; Hosted UI prelude for domain-neutral ViewSpec component forms.
;
; This file intentionally contains no domain vocabulary. ViewSpec forms live in
; viewspec.lisp and are loaded after this file so they inherit the same hosted
; DSL symbol table.
; -----------------------------------------------------------------------------
(define
  text.metadata
  (quote
    {
      :descriptor-name "text"
      :extensions
        {
          :view/component
            {
              :allows-bind true
              :compile {:expr-props ["visible" "bind"]}
              :children "none"
              :positional-prop "content"}}}))
(form
  (text content {:keys [visible bind]})
  :types
    {
      :content (Option (Expr a))
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))}
  :ir ComponentIR
  (component "text" {"content" content "visible" visible "bind" bind} []))
(define
  rows.metadata
  (quote
    {
      :descriptor-name "rows"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"] :required-children true}
              :children "any"}}}))
(form
  (rows {:keys [gap visible]} child ...)
  :types
    {:gap (Option Number) :visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "rows" {"gap" gap "visible" visible} child))
(define
  columns.metadata
  (quote
    {
      :descriptor-name "columns"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"] :required-children true}
              :children "any"}}}))
(form
  (columns {:keys [gap visible]} child ...)
  :types
    {:gap (Option Number) :visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "columns" {"gap" gap "visible" visible} child))
(define
  card.metadata
  (quote
    {
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
              :children "any"}}}))
(form
  (card
    {:keys [title description subject-mode action footer visible]}
    child
    ...)
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
(define
  item-group.metadata
  (quote
    {
      :descriptor-name "item-group"
      :extensions
        {
          :view/component
            {
              :allows-bind true
              :compile {:expr-props ["visible" "bind"] :required-children true}
              :children "any"}}}))
(form
  (item-group {:keys [visible bind]} child ...)
  :types
    {
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))
      :child (List component)}
  :ir ComponentIR
  (component "item-group" {"visible" visible "bind" bind} child))
(define
  item.metadata
  (quote
    {
      :descriptor-name "item"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"]}
              :children "any"
              :events {:on-click "onClick"}}}}))
(form
  (item
    {
      :keys
        [variant size icon title description value badge badge-variant visible]}
    child
    ...)
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
(define
  button.metadata
  (quote
    {
      :descriptor-name "button"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible" "disabled"]}
              :children "any"
              :events {:on-click "onClick"}
              :positional-prop "label"}}}))
(form
  (button label {:keys [variant size disabled button-type visible]} child ...)
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
(define
  progress.metadata
  (quote
    {
      :descriptor-name "progress"
      :extensions
        {
          :view/component
            {
              :allows-bind true
              :compile {:expr-props ["visible" "bind"]}
              :children "none"}}}))
(form
  (progress {:keys [value label hint visible bind]})
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
(define
  workflow-strip.metadata
  (quote
    {
      :descriptor-name "workflow-strip"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :children ["only" ["workflow-step"]]
              :compile {:required-children true}}}}))
(form
  (workflow-strip {:keys [title description visible]} child ...)
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
(define
  workflow-step.metadata
  (quote
    {
      :descriptor-name "workflow-step"
      :extensions
        {
          :view/component
            {:allows-bind false :children "none" :parents ["workflow-strip"]}}}))
(form
  (workflow-step {:keys [label description status icon visible]})
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
(define
  empty-state.metadata
  (quote
    {
      :descriptor-name "empty-state"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"]}
              :children "any"}}}))
(form
  (empty-state {:keys [icon title description visible]} child ...)
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
(define
  badge.metadata
  (quote
    {
      :descriptor-name "badge"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"]}
              :children "none"
              :positional-prop "content"}}}))
(form
  (badge content {:keys [variant dot dot-color visible]})
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
(define
  avatar.metadata
  (quote
    {
      :descriptor-name "avatar"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"]}
              :children "none"}}}))
(form
  (avatar {:keys [src alt fallback size visible]})
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
(define
  kbd.metadata
  (quote
    {
      :descriptor-name "kbd"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"]}
              :children "none"
              :positional-prop "content"}}}))
(form
  (kbd content {:keys [visible]})
  :types {:content (Option (Expr a)) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "kbd" {"content" content "visible" visible} []))
(define
  spinner.metadata
  (quote
    {
      :descriptor-name "spinner"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"]}
              :children "none"}}}))
(form
  (spinner {:keys [label size visible]})
  :types
    {
      :label (Option (Expr a))
      :size (Option (Union "sm" "default" "lg"))
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "spinner" {"label" label "size" size "visible" visible} []))
(define
  separator.metadata
  (quote
    {
      :descriptor-name "separator"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"]}
              :children "none"}}}))
(form
  (separator {:keys [orientation visible]})
  :types
    {
      :orientation (Option (Union "horizontal" "vertical"))
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "separator" {"orientation" orientation "visible" visible} []))
(define
  tabs.metadata
  (quote
    {
      :descriptor-name "tabs"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"] :required-children true}
              :children ["only" ["tab-panel"]]}}}))
(form
  (tabs {:keys [visible]} child ...)
  :types {:visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "tabs" {"visible" visible} child))
(define
  tab-panel.metadata
  (quote
    {
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
              :parents ["tabs"]}}}))
(form
  (tab-panel {:keys [label visible]} child ...)
  :types
    {
      :label (Option (Expr a))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "tab-panel" {"label" label "visible" visible} child))
(define
  accordion.metadata
  (quote
    {
      :descriptor-name "accordion"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"] :required-children true}
              :children ["only" ["accordion-item"]]}}}))
(form
  (accordion {:keys [mode visible]} child ...)
  :types
    {
      :mode (Option (Union "single" "multiple"))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "accordion" {"mode" mode "visible" visible} child))
(define
  accordion-item.metadata
  (quote
    {
      :descriptor-name "accordion-item"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"] :required-children true}
              :children "any"
              :parents ["accordion"]}}}))
(form
  (accordion-item {:keys [title default-open visible]} child ...)
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
(define
  grid.metadata
  (quote
    {
      :descriptor-name "grid"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"] :required-children true}
              :children "any"}}}))
(form
  (grid {:keys [columns visible]} child ...)
  :types
    {
      :columns (Option Number)
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "grid" {"columns" columns "visible" visible} child))
(define
  aspect-ratio.metadata
  (quote
    {
      :descriptor-name "aspect-ratio"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"] :required-children true}
              :children "any"}}}))
(form
  (aspect-ratio {:keys [ratio visible]} child ...)
  :types
    {
      :ratio (Option Number)
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "aspect-ratio" {"ratio" ratio "visible" visible} child))
(define
  spacer.metadata
  (quote
    {
      :descriptor-name "spacer"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"]}
              :children "none"}}}))
(form
  (spacer {:keys [height visible]})
  :types {:height (Option Number) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "spacer" {"height" height "visible" visible} []))
(define
  split-pane.metadata
  (quote
    {
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
              :children "any"}}}))
(form
  (split-pane {:keys [direction sizes visible]} child ...)
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
(define
  for-each.metadata
  (quote
    {
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
              :children "any"}}}))
(form
  (for-each {:keys [empty-text visible bind]} child ...)
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
(define
  condition.metadata
  (quote
    {
      :descriptor-name "condition"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"] :required-children true}
              :children ["only" ["case" "else"]]}}}))
(form
  (condition {:keys [visible]} child ...)
  :types {:visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "condition" {"visible" visible} child))
(define
  case.metadata
  (quote
    {
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
              :parents ["condition"]}}}))
(form
  (case {:keys [when visible]} child ...)
  :types {:when (Expr a) :visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "case" {"when" when "visible" visible} child))
(define
  else.metadata
  (quote
    {
      :descriptor-name "else"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"] :required-children true}
              :children "any"
              :parents ["condition"]}}}))
(form
  (else {:keys [visible]} child ...)
  :types {:visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "else" {"visible" visible} child))
(define
  slot.metadata
  (quote
    {
      :descriptor-name "slot"
      :extensions
        {
          :view/component
            {
              :allows-bind true
              :compile {:expr-props ["visible" "bind"]}
              :children "any"
              :positional-prop "name"}}}))
(form
  (slot name {:keys [visible bind]} child ...)
  :types
    {
      :name (Option String)
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))
      :child (List component)}
  :ir ComponentIR
  (component "slot" {"name" name "visible" visible "bind" bind} child))
(define
  use.metadata
  (quote
    {
      :descriptor-name "use"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"]}
              :children "any"
              :positional-prop "name"}}}))
(form
  (use name {:keys [overrides visible]} child ...)
  :types
    {
      :name String
      :overrides (Option Json)
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "use" {"name" name "overrides" overrides "visible" visible} child))
(define
  tooltip.metadata
  (quote
    {
      :descriptor-name "tooltip"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"] :required-children true}
              :children "any"}}}))
(form
  (tooltip {:keys [content side visible]} child ...)
  :types
    {
      :content (Expr a)
      :side (Option (Union "top" "right" "bottom" "left"))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "tooltip" {"content" content "side" side "visible" visible} child))
(define
  popover.metadata
  (quote
    {
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
              :children "any"}}}))
(form
  (popover {:keys [trigger title description side align visible]} child ...)
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
(define
  hover-card.metadata
  (quote
    {
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
              :children "any"}}}))
(form
  (hover-card {:keys [trigger side align visible]} child ...)
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
(define
  dialog.metadata
  (quote
    {
      :descriptor-name "dialog"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"] :required-children true}
              :children "any"
              :events {:on-open-change "onOpenChange"}}}}))
(form
  (dialog {:keys [dialog-id title description visible]} child ...)
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
(define
  table.metadata
  (quote
    {
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
                      :columns
                        {:kind "array" :item ["string" "ViewTableColumn"]}
                      :filters
                        {:kind "array" :item ["string" "ViewTableFilter"]}
                      :default-sort "ViewTableSort"}}
              :children "none"
              :events {:on-row-click "onRowClick"}}}}))
(form
  (table
    {:keys [columns filters page-size default-sort empty-state visible bind]})
  :types
    {
      :columns (Option Json)
      :filters (Option Json)
      :page-size (Option Number)
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
(define
  tree.metadata
  (quote
    {
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
              :events {:on-node-click "onNodeClick"}}}}))
(form
  (tree
    {:keys [id-key parent-id-key label-key default-expanded visible bind]}
    child
    ...)
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
(define
  metric.metadata
  (quote
    {
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
              :children "none"}}}))
(form
  (metric {:keys [label value value-key visible bind]})
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
(define
  chart.metadata
  (quote
    {
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
              :children "none"}}}))
(form
  (chart {:keys [title chart-type category-key series visible bind]})
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
(define
  markdown.metadata
  (quote
    {
      :descriptor-name "markdown"
      :extensions
        {
          :view/component
            {
              :allows-bind true
              :compile {:expr-props ["visible" "bind"]}
              :children "none"
              :positional-prop "content"}}}))
(form
  (markdown content {:keys [visible bind]})
  :types
    {
      :content (Option (Expr a))
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))}
  :ir ComponentIR
  (component "markdown" {"content" content "visible" visible "bind" bind} []))
(define
  stat-group.metadata
  (quote
    {
      :descriptor-name "stat-group"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"] :required-children true}
              :children "any"}}}))
(form
  (stat-group {:keys [gap visible]} child ...)
  :types
    {:gap (Option Number) :visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "stat-group" {"gap" gap "visible" visible} child))
(define
  heading.metadata
  (quote
    {
      :descriptor-name "heading"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"]}
              :children "none"
              :positional-prop "text"}}}))
(form
  (heading text {:keys [level visible]})
  :types
    {
      :text (Option (Expr a))
      :level (Option Number)
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "heading" {"text" text "level" level "visible" visible} []))
(define
  divider.metadata
  (quote
    {
      :descriptor-name "divider"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"]}
              :children "none"}}}))
(form
  (divider {:keys [visible]})
  :types {:visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "divider" {"visible" visible} []))
(define
  alert.metadata
  (quote
    {
      :descriptor-name "alert"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile
                {:expr-props ["visible"] :slot-defaults {:message "empty-expr"}}
              :children "none"
              :positional-prop "message"}}}))
(form
  (alert message {:keys [variant visible]})
  :types
    {
      :message (Expr a)
      :variant (Option (Union "default" "warning" "error" "info"))
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "alert" {"message" message "variant" variant "visible" visible} []))
(define
  form.metadata
  (quote
    {
      :descriptor-name "form"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"] :required-children true}
              :children "any"
              :events {:on-submit "onSubmit"}}}}))
(form
  (form {:keys [title description visible]} child ...)
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
(define
  button-group.metadata
  (quote
    {
      :descriptor-name "button-group"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"] :required-children true}
              :children "any"}}}))
(form
  (button-group {:keys [orientation visible]} child ...)
  :types
    {
      :orientation (Option (Union "horizontal" "vertical"))
      :visible (Option (Expr Bool))
      :child (List component)}
  :ir ComponentIR
  (component "button-group" {"orientation" orientation "visible" visible} child))
(define
  breadcrumb.metadata
  (quote
    {
      :descriptor-name "breadcrumb"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"] :required-children true}
              :children ["only" ["breadcrumb-item"]]}}}))
(form
  (breadcrumb {:keys [visible]} child ...)
  :types {:visible (Option (Expr Bool)) :child (List component)}
  :ir ComponentIR
  (component "breadcrumb" {"visible" visible} child))
(define
  breadcrumb-item.metadata
  (quote
    {
      :descriptor-name "breadcrumb-item"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"]}
              :children "none"
              :parents ["breadcrumb"]
              :events {:on-click "onClick"}}}}))
(form
  (breadcrumb-item {:keys [label href current visible]})
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
(define
  input.metadata
  (quote
    {
      :descriptor-name "input"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"]}
              :children "none"
              :events {:on-change "onChange"}}}}))
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
(define
  textarea.metadata
  (quote
    {
      :descriptor-name "textarea"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"]}
              :children "none"
              :events {:on-change "onChange"}}}}))
(form
  (textarea {:keys [name default-value label description placeholder visible]})
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
(define
  checkbox.metadata
  (quote
    {
      :descriptor-name "checkbox"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"]}
              :children "none"
              :events {:on-change "onChange"}}}}))
(form
  (checkbox {:keys [name default-value label description visible]})
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
(define
  switch.metadata
  (quote
    {
      :descriptor-name "switch"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"]}
              :children "none"
              :events {:on-change "onChange"}}}}))
(form
  (switch {:keys [name default-value label description visible]})
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
(define
  select.metadata
  (quote
    {
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
              :events {:on-change "onChange"}}}}))
(form
  (select
    {:keys [name default-value label description placeholder options visible]}
    child
    ...)
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
(define
  select-option.metadata
  (quote
    {
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
              :parents ["select"]}}}))
(form
  (select-option {:keys [value label visible]})
  :types {:value String :label (Option (Expr a)) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "select-option" {"value" value "label" label "visible" visible} []))
(define
  radio-group.metadata
  (quote
    {
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
              :events {:on-change "onChange"}}}}))
(form
  (radio-group
    {:keys [name default-value label description options visible]}
    child
    ...)
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
(define
  radio-option.metadata
  (quote
    {
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
              :parents ["radio-group"]}}}))
(form
  (radio-option {:keys [value label visible]})
  :types {:value String :label (Option (Expr a)) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "radio-option" {"value" value "label" label "visible" visible} []))
(define
  slider.metadata
  (quote
    {
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
              :events {:on-change "onChange"}}}}))
(form
  (slider {:keys [name default-value label description min max step visible]})
  :types
    {
      :name String
      :default-value (Option (Expr a))
      :label (Option (Expr a))
      :description (Option (Expr a))
      :min (Option Number)
      :max (Option Number)
      :step (Option Number)
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
(define
  toggle-group.metadata
  (quote
    {
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
              :events {:on-change "onChange"}}}}))
(form
  (toggle-group {:keys [name default-value mode variant options visible]})
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
(define
  skeleton.metadata
  (quote
    {
      :descriptor-name "skeleton"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"]}
              :children "none"}}}))
(form
  (skeleton {:keys [lines visible]})
  :types {:lines (Option Number) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "skeleton" {"lines" lines "visible" visible} []))
(define
  raw-html.metadata
  (quote
    {
      :descriptor-name "raw-html"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"]}
              :children "none"
              :positional-prop "content"}}}))
(form
  (raw-html content {:keys [visible]})
  :types {:content (Expr a) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "raw-html" {"content" content "visible" visible} []))
(define
  raw-css.metadata
  (quote
    {
      :descriptor-name "raw-css"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"]}
              :children "none"
              :positional-prop "content"}}}))
(form
  (raw-css content {:keys [visible]})
  :types {:content (Expr a) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "raw-css" {"content" content "visible" visible} []))
(define
  raw-js.metadata
  (quote
    {
      :descriptor-name "raw-js"
      :extensions
        {
          :view/component
            {
              :allows-bind false
              :compile {:expr-props ["visible"]}
              :children "none"
              :positional-prop "code"}}}))
(form
  (raw-js code {:keys [visible]})
  :types {:code (Expr a) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "raw-js" {"code" code "visible" visible} []))
(define
  custom.metadata
  (quote
    {
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
              :children "any"}}}))
(form
  (custom {:keys [component-name props visible]} child ...)
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
(define
  component-ref
  (quote
    {:extensions {:view/layout-alias {:form "component-ref" :to "view-ref"}}}))
(define
  cond
  (quote {:extensions {:view/layout-alias {:form "cond" :to "condition"}}}))
