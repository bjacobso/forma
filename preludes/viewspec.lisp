; viewspec.lisp
; -----------------------------------------------------------------------------
; Purpose: Ontology-aware UI components and hosted layout aliases.
; Requires: ui.lisp; ontology.lisp supplies enclosing view declarations.
; Used by: Ontology view layouts and downstream host renderers.
; -----------------------------------------------------------------------------
(define entity-browser.metadata
  '{
     :descriptor-name "entity-browser"
     :extensions
       {
         :view/component
           {
             :allows-bind true
             :compile {:expr-props ["visible" "bind"]}
             :children "none"
             :events {:on-row-click "onRowClick"}}}})

(form (entity-browser {:keys [title visible bind]})
  :types
    {
      :title (Option (Expr a))
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))}
  :ir ComponentIR
  (component "entity-browser" {"title" title "visible" visible "bind" bind} []))

(define action-button.metadata
  '{
     :descriptor-name "action-button"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile
               {
                 :expr-props ["visible"]
                 :json-slots ["parameters"]
                 :slot-types {:parameters {:kind "record" :value "unknown"}}}
             :children "none"
             :events {:on-click "onClick" :on-success "onSuccess"}}}})

(form
  (action-button
    {:keys [label variant action-ref entity-id parameters visible]})
  :types
    {
      :label (Option (Expr a))
      :variant
        (Option (Union "default" "destructive" "outline" "secondary" "ghost"))
      :action-ref (Option String)
      :entity-id (Option (Expr a))
      :parameters (Option Json)
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component
    "action-button"
    {
      "label" label
      "variant" variant
      "action-ref" action-ref
      "entity-id" entity-id
      "parameters" parameters
      "visible" visible}
    []))

(define create-entity-button.metadata
  '{
     :descriptor-name "create-entity-button"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "none"
             :events {:on-click "onClick" :on-success "onSuccess"}}}})

(form (create-entity-button {:keys [label entity-type variant visible]})
  :types
    {
      :label (Option (Expr a))
      :entity-type String
      :variant
        (Option (Union "default" "destructive" "outline" "secondary" "ghost"))
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component
    "create-entity-button"
    {
      "label" label
      "entity-type" entity-type
      "variant" variant
      "visible" visible}
    []))

(define entity-picker.metadata
  '{
     :descriptor-name "entity-picker"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "none"
             :events {:on-change "onChange"}}}})

(form
  (entity-picker
    {:keys [name label description placeholder entity-type visible]})
  :types
    {
      :name String
      :label (Option (Expr a))
      :description (Option (Expr a))
      :placeholder (Option String)
      :entity-type (Option String)
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component
    "entity-picker"
    {
      "name" name
      "label" label
      "description" description
      "placeholder" placeholder
      "entity-type" entity-type
      "visible" visible}
    []))

(define query-console.metadata
  '{
     :descriptor-name "query-console"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile {:expr-props ["visible"]}
             :children "none"}}})

(form (query-console {:keys [title visible]})
  :types {:title (Option (Expr a)) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "query-console" {"title" title "visible" visible} []))

(define view-ref.metadata
  '{
     :descriptor-name "view-ref"
     :extensions
       {
         :view/component
           {
             :allows-bind false
             :compile
               {
                 :expr-props ["visible"]
                 :json-slots ["input"]
                 :slot-types {:input {:kind "record" :value "unknown"}}}
             :children "none"
             :positional-prop "name"}}})

(form (view-ref name {:keys [input visible]})
  :types {:name String :input (Option Json) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "view-ref" {"name" name "input" input "visible" visible} []))

(define action-form
  '{:extensions {:view/layout-alias {:form "action-form" :to "action-button"}}})

(define entity-table
  '{
     :extensions
       {
         :view/layout-alias
           {:form "entity-table" :component-name "runtime/entity-table"}}})

(define entity-detail
  '{
     :extensions
       {
         :view/layout-alias
           {:form "entity-detail" :component-name "runtime/entity-detail"}}})

(define entity-form
  '{
     :extensions
       {
         :view/layout-alias
           {:form "entity-form" :component-name "runtime/entity-form"}}})

(define task-queue
  '{
     :extensions
       {
         :view/layout-alias
           {:form "task-queue" :component-name "runtime/task-queue"}}})

(define task-detail
  '{
     :extensions
       {
         :view/layout-alias
           {:form "task-detail" :component-name "runtime/task-detail"}}})

(define task-summary
  '{
     :extensions
       {
         :view/layout-alias
           {:form "task-summary" :component-name "runtime/task-summary"}}})

(define task-status-editor
  '{
     :extensions
       {
         :view/layout-alias
           {
             :form "task-status-editor"
             :component-name "runtime/task-status-editor"}}})

(define task-document-links
  '{
     :extensions
       {
         :view/layout-alias
           {
             :form "task-document-links"
             :component-name "runtime/task-document-links"}}})

(define task-metadata
  '{
     :extensions
       {
         :view/layout-alias
           {:form "task-metadata" :component-name "runtime/task-metadata"}}})

(define violation-list
  '{
     :extensions
       {
         :view/layout-alias
           {:form "violation-list" :component-name "runtime/violation-list"}}})

(define violation-detail
  '{
     :extensions
       {
         :view/layout-alias
           {:form "violation-detail" :component-name "runtime/violation-detail"}}})

(define violation-summary
  '{
     :extensions
       {
         :view/layout-alias
           {
             :form "violation-summary"
             :component-name "runtime/violation-summary"}}})

(define violation-status-editor
  '{
     :extensions
       {
         :view/layout-alias
           {
             :form "violation-status-editor"
             :component-name "runtime/violation-status-editor"}}})

(define violation-related-records
  '{
     :extensions
       {
         :view/layout-alias
           {
             :form "violation-related-records"
             :component-name "runtime/violation-related-records"}}})

(define violation-timeline
  '{
     :extensions
       {
         :view/layout-alias
           {
             :form "violation-timeline"
             :component-name "runtime/violation-timeline"}}})
