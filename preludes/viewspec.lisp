; viewspec.lisp
; -----------------------------------------------------------------------------
; Purpose: Ontology-aware UI components and hosted layout aliases.
; Requires: ui.lisp; ontology.lisp supplies enclosing view declarations.
; Used by: Ontology view layouts and downstream host renderers.
; -----------------------------------------------------------------------------

(form (entity-browser {:keys [title visible bind]})
  "Builds an ontology entity-browser node with optional title and binding,
   and an on-row-click event mapping."
  :examples
    [[(view Example
        :state {:items []}
        :layout (entity-browser :title "People" :bind $state.items))]]
  :extensions
    {
      :view/component
        {
          :allows-bind true
          :compile {:expr-props ["visible" "bind"]}
          :children "none"
          :events {:on-row-click "onRowClick"}}}
  :types
    {
      :title (Option (Expr a))
      :visible (Option (Expr Bool))
      :bind (Option (Expr a))}
  :ir ComponentIR
  (component "entity-browser" (named-map title visible bind) []))

(form
  (action-button
    {:keys [label variant action-ref entity-id parameters visible]})
  "Builds an action-button configuration with an action reference, optional
   entity identifier and parameters, and click and success event mappings."
  :examples
    [[(view Example
        :layout
          (action-button :label "Save" :action-ref "save" :parameters {}))]]
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
          :events {:on-click "onClick" :on-success "onSuccess"}}}
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
  (component "action-button"
    (named-map label variant action-ref entity-id parameters visible)
    []))

(form (create-entity-button {:keys [label entity-type variant visible]})
  "Builds a create-entity-button configuration for a required entity-type
   string, with optional label and variant."
  :examples
    [[(view Example
        :layout
          (create-entity-button :entity-type "Person" :label "New person"))]]
  :extensions
    {
      :view/component
        {
          :allows-bind false
          :compile {:expr-props ["visible"]}
          :children "none"
          :events {:on-click "onClick" :on-success "onSuccess"}}}
  :types
    {
      :label (Option (Expr a))
      :entity-type String
      :variant
        (Option (Union "default" "destructive" "outline" "secondary" "ghost"))
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "create-entity-button"
    (named-map label entity-type variant visible)
    []))

(form
  (entity-picker
    {:keys [name label description placeholder entity-type visible]})
  "Builds a named entity-picker configuration with optional labels,
   placeholder, and entity-type filter."
  :examples
    [[(view Example
        :layout (entity-picker :name "person" :entity-type "Person"))]]
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
      :label (Option (Expr a))
      :description (Option (Expr a))
      :placeholder (Option String)
      :entity-type (Option String)
      :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "entity-picker"
    (named-map name label description placeholder entity-type visible)
    []))

(form (query-console {:keys [title visible]})
  "Builds a query-console configuration node with optional title and
   visibility expressions."
  :examples
    [[(view Example :layout (query-console :title "Explore"))]]
  :extensions
    {
      :view/component
        {:allows-bind false :compile {:expr-props ["visible"]} :children "none"}}
  :types {:title (Option (Expr a)) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "query-console" (named-map title visible) []))

(form (view-ref name {:keys [input visible]})
  "Builds a reference to a view by string name, with optional JSON input and
   visibility."
  :examples
    [[(view Example :layout (view-ref "People" :input {:page 1}))]]
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
          :positional-prop "name"}}
  :types {:name String :input (Option Json) :visible (Option (Expr Bool))}
  :ir ComponentIR
  (component "view-ref" (named-map name input visible) []))

; Constant host layout alias; the target component is interpreted downstream.
(define action-form
  '{:extensions {:view/layout-alias {:form "action-form" :to "action-button"}}})

; Constant host layout alias; the target component is interpreted downstream.
(define entity-table
  '{
     :extensions
       {
         :view/layout-alias
           {:form "entity-table" :component-name "runtime/entity-table"}}})

; Constant host layout alias; the target component is interpreted downstream.
(define entity-detail
  '{
     :extensions
       {
         :view/layout-alias
           {:form "entity-detail" :component-name "runtime/entity-detail"}}})

; Constant host layout alias; the target component is interpreted downstream.
(define entity-form
  '{
     :extensions
       {
         :view/layout-alias
           {:form "entity-form" :component-name "runtime/entity-form"}}})

; Constant host layout alias; the target component is interpreted downstream.
(define task-queue
  '{
     :extensions
       {
         :view/layout-alias
           {:form "task-queue" :component-name "runtime/task-queue"}}})

; Constant host layout alias; the target component is interpreted downstream.
(define task-detail
  '{
     :extensions
       {
         :view/layout-alias
           {:form "task-detail" :component-name "runtime/task-detail"}}})

; Constant host layout alias; the target component is interpreted downstream.
(define task-summary
  '{
     :extensions
       {
         :view/layout-alias
           {:form "task-summary" :component-name "runtime/task-summary"}}})

; Constant host layout alias; the target component is interpreted downstream.
(define task-status-editor
  '{
     :extensions
       {
         :view/layout-alias
           {
             :form "task-status-editor"
             :component-name "runtime/task-status-editor"}}})

; Constant host layout alias; the target component is interpreted downstream.
(define task-document-links
  '{
     :extensions
       {
         :view/layout-alias
           {
             :form "task-document-links"
             :component-name "runtime/task-document-links"}}})

; Constant host layout alias; the target component is interpreted downstream.
(define task-metadata
  '{
     :extensions
       {
         :view/layout-alias
           {:form "task-metadata" :component-name "runtime/task-metadata"}}})

; Constant host layout alias; the target component is interpreted downstream.
(define violation-list
  '{
     :extensions
       {
         :view/layout-alias
           {:form "violation-list" :component-name "runtime/violation-list"}}})

; Constant host layout alias; the target component is interpreted downstream.
(define violation-detail
  '{
     :extensions
       {
         :view/layout-alias
           {:form "violation-detail" :component-name "runtime/violation-detail"}}})

; Constant host layout alias; the target component is interpreted downstream.
(define violation-summary
  '{
     :extensions
       {
         :view/layout-alias
           {
             :form "violation-summary"
             :component-name "runtime/violation-summary"}}})

; Constant host layout alias; the target component is interpreted downstream.
(define violation-status-editor
  '{
     :extensions
       {
         :view/layout-alias
           {
             :form "violation-status-editor"
             :component-name "runtime/violation-status-editor"}}})

; Constant host layout alias; the target component is interpreted downstream.
(define violation-related-records
  '{
     :extensions
       {
         :view/layout-alias
           {
             :form "violation-related-records"
             :component-name "runtime/violation-related-records"}}})

; Constant host layout alias; the target component is interpreted downstream.
(define violation-timeline
  '{
     :extensions
       {
         :view/layout-alias
           {
             :form "violation-timeline"
             :component-name "runtime/violation-timeline"}}})
