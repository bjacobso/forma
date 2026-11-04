; viewspec-protocol.lisp
; -----------------------------------------------------------------------------
; Purpose: Hosted ViewSpec expression, action, and non-component wire contracts.
; Requires: Core types; ui.lisp and viewspec.lisp supply the associated component descriptors.
; Used by: Hosted layout compilation, protocol generation, and snapshot checks.
; -----------------------------------------------------------------------------
; Adapter dispatch and descriptor namespaces read by descriptor-tree-metadata.ts.
; meta-builtins.ts uses the registry for hosted compilation and validation.
; Field names and expression/action conventions already live in their consumers.
(define view-protocol-registry
  {:extensions
    {:protocol/registry
      {
        ; Hosted adapter and descriptor namespaces.
        :compile-layout-tree-op "view/compile-layout-tree"
        :hosted-dsl-name "viewspec"
        :component-extension "view/component"
        :layout-alias-extension "view/layout-alias"
        ; Call conventions exposed to registry consumers.
        :allow-default-component-layout-args true
        :allow-hosted-dsl-name-layout-args true
        ; Target for host layout aliases without an explicit destination.
        :layout-alias-default-to "custom"}}})

(define view-component-protocol
  {
    :extensions
      {
        :view/component-protocol
          {
            :prop-name-normalization "camel-case"
            :type-field "type"
            :props-field "props"
            :events-field "events"
            :children-field "children"
            :bind-prop "bind"
            :required-bind-value []
            :scalar-fallback-field "text"
            :scalar-fallback-kind "value"
            :unknown-props "json"}}})

; ViewSpec expression root source.
(type ViewExprSource
  (Union
    "state"
    "query"
    "input"
    "row"
    "db"
    "item"
    "index"
    "event"
    "result"
    "error"
    "host"))

(define view-expr-get
  {:extensions {:view/expr-op {:form "get" :lowering "get-path"}}})

(define view-expr-length-op
  {
    :extensions
      {:view/expr-op {:form "length" :lowering "pipe-call" :name "length"}}})

(define view-expr-not-op
  {:extensions {:view/expr-op {:form "not" :lowering "unary" :op "!"}}})

(define view-expr-nil-op
  {:extensions {:view/expr-op {:form "nil?" :lowering "compare-nil"}}})

(define view-expr-equals-op
  {:extensions {:view/expr-op {:form "=" :lowering "binary" :op "==="}}})

(define view-expr-not-equals-op
  {:extensions {:view/expr-op {:form "!=" :lowering "binary" :op "!=="}}})

(define view-expr-greater-than-op
  {:extensions {:view/expr-op {:form ">" :lowering "binary" :op ">"}}})

(define view-expr-greater-than-or-equal-op
  {:extensions {:view/expr-op {:form ">=" :lowering "binary" :op ">="}}})

(define view-expr-less-than-op
  {:extensions {:view/expr-op {:form "<" :lowering "binary" :op "<"}}})

(define view-expr-less-than-or-equal-op
  {:extensions {:view/expr-op {:form "<=" :lowering "binary" :op "<="}}})

(define view-expr-add-op
  {:extensions {:view/expr-op {:form "+" :lowering "binary" :op "+"}}})

(define view-expr-subtract-op
  {:extensions {:view/expr-op {:form "-" :lowering "binary" :op "-"}}})

(define view-expr-multiply-op
  {:extensions {:view/expr-op {:form "*" :lowering "binary" :op "*"}}})

(define view-expr-divide-op
  {:extensions {:view/expr-op {:form "/" :lowering "binary" :op "/"}}})

(define view-expr-and-op
  {:extensions {:view/expr-op {:form "and" :lowering "binary" :op "&&"}}})

(define view-expr-or-op
  {:extensions {:view/expr-op {:form "or" :lowering "binary" :op "||"}}})

(define view-expr-if-op
  {:extensions {:view/expr-op {:form "if" :lowering "conditional"}}})

(define view-expr-pipe-op
  {:extensions {:view/expr-op {:form "pipe" :lowering "pipe-chain"}}})

(type ViewExprLiteral {:kind "literal" :value Json})

(type ViewExprVar
  {:kind "var" :source ViewExprSource :path (Option (List String))})

(type ViewExprBinary
  {
    :kind "binary"
    :op (Union "===" "!==" ">" ">=" "<" "<=" "+" "-" "*" "/" "&&" "||")
    :left ViewExpr
    :right ViewExpr})

(type ViewExprUnary {:kind "unary" :op (Union "!" "-") :value ViewExpr})

(type ViewExprConditional
  {:kind "conditional" :condition ViewExpr :then ViewExpr :else ViewExpr})

(type ViewExprPipe
  {:kind "pipe" :name String :value ViewExpr :args (Option (List ViewExpr))})

(type ViewExpr
  (Union
    ViewExprLiteral
    ViewExprVar
    ViewExprBinary
    ViewExprUnary
    ViewExprConditional
    ViewExprPipe))

(type ViewExprNode ViewExpr)

(type ViewSetStateAction
  {
    :action "setState"
    :key String
    :value Json
    :onSuccess (Option ViewActionOrList)
    :onError (Option ViewActionOrList)
    :onFinally (Option ViewActionOrList)})

(type ViewPatchStateAction
  {
    :action "patchState"
    :key String
    :value Json
    :onSuccess (Option ViewActionOrList)
    :onError (Option ViewActionOrList)
    :onFinally (Option ViewActionOrList)})

(type ViewToggleStateAction
  {
    :action "toggleState"
    :key String
    :onSuccess (Option ViewActionOrList)
    :onError (Option ViewActionOrList)
    :onFinally (Option ViewActionOrList)})

(type ViewRunQueryAction
  {
    :action "runQuery"
    :query String
    :onSuccess (Option ViewActionOrList)
    :onError (Option ViewActionOrList)
    :onFinally (Option ViewActionOrList)})

(type ViewRunQueriesAction
  {
    :action "runQueries"
    :queries (List String)
    :onSuccess (Option ViewActionOrList)
    :onError (Option ViewActionOrList)
    :onFinally (Option ViewActionOrList)})

(type ViewNavigateAction
  {
    :action "navigate"
    :path ViewExpr
    :onSuccess (Option ViewActionOrList)
    :onError (Option ViewActionOrList)
    :onFinally (Option ViewActionOrList)})

(type ViewShowToastAction
  {
    :action "showToast"
    :message ViewExpr
    :description (Option ViewExpr)
    :variant (Option (Union "default" "success" "error" "warning" "info"))
    :duration (Option Float)
    :onSuccess (Option ViewActionOrList)
    :onError (Option ViewActionOrList)
    :onFinally (Option ViewActionOrList)})

(type ViewOpenDialogAction
  {
    :action "openDialog"
    :dialogId String
    :onSuccess (Option ViewActionOrList)
    :onError (Option ViewActionOrList)
    :onFinally (Option ViewActionOrList)})

(type ViewCloseDialogAction
  {
    :action "closeDialog"
    :dialogId (Option String)
    :onSuccess (Option ViewActionOrList)
    :onError (Option ViewActionOrList)
    :onFinally (Option ViewActionOrList)})

(type ViewEmitAction
  {
    :action "emit"
    :event String
    :payload (Option Json)
    :onSuccess (Option ViewActionOrList)
    :onError (Option ViewActionOrList)
    :onFinally (Option ViewActionOrList)})

(type ViewExecuteActionAction
  {
    :action "executeAction"
    :actionRef String
    :entityId (Option ViewExpr)
    :parameters (Option (Map String Json))
    :onSuccess (Option ViewActionOrList)
    :onError (Option ViewActionOrList)
    :onFinally (Option ViewActionOrList)})

(type ViewFetchAction
  {
    :action "fetch"
    :url ViewExpr
    :method (Option (Union "GET" "POST" "PUT" "PATCH" "DELETE"))
    :headers (Option (Map String Json))
    :body (Option Json)
    :onSuccess (Option ViewActionOrList)
    :onError (Option ViewActionOrList)
    :onFinally (Option ViewActionOrList)})

(type ViewToolCallAction
  {
    :action "toolCall"
    :tool ViewExpr
    :arguments (Option (Map String Json))
    :onSuccess (Option ViewActionOrList)
    :onError (Option ViewActionOrList)
    :onFinally (Option ViewActionOrList)})

(type ViewRequestDisplayModeAction
  {
    :action "requestDisplayMode"
    :mode (Union "inline" "fullscreen" "pip")
    :onSuccess (Option ViewActionOrList)
    :onError (Option ViewActionOrList)
    :onFinally (Option ViewActionOrList)})

(type ViewUpdateContextAction
  {
    :action "updateContext"
    :content (Option ViewExpr)
    :structuredContent (Option (Map String Json))
    :onSuccess (Option ViewActionOrList)
    :onError (Option ViewActionOrList)
    :onFinally (Option ViewActionOrList)})

(type ViewSendMessageAction
  {
    :action "sendMessage"
    :content ViewExpr
    :onSuccess (Option ViewActionOrList)
    :onError (Option ViewActionOrList)
    :onFinally (Option ViewActionOrList)})

(type ViewOpenFilePickerAction
  {
    :action "openFilePicker"
    :accept (Option String)
    :multiple (Option Bool)
    :maxSize (Option Float)
    :onSuccess (Option ViewActionOrList)
    :onError (Option ViewActionOrList)
    :onFinally (Option ViewActionOrList)})

(type ViewAction
  (Union
    ViewSetStateAction
    ViewPatchStateAction
    ViewToggleStateAction
    ViewRunQueryAction
    ViewRunQueriesAction
    ViewNavigateAction
    ViewShowToastAction
    ViewOpenDialogAction
    ViewCloseDialogAction
    ViewEmitAction
    ViewExecuteActionAction
    ViewFetchAction
    ViewToolCallAction
    ViewRequestDisplayModeAction
    ViewUpdateContextAction
    ViewSendMessageAction
    ViewOpenFilePickerAction))

;; Event maps
(type ViewClickEventMap {:onClick (Option ViewActionOrList)})

(type ViewActionButtonEventMap
  {:onClick (Option ViewActionOrList) :onSuccess (Option ViewActionOrList)})

(type ViewRowClickEventMap {:onRowClick (Option ViewActionOrList)})

(type ViewNodeClickEventMap {:onNodeClick (Option ViewActionOrList)})

(type ViewChangeEventMap {:onChange (Option ViewActionOrList)})

(type ViewSubmitEventMap {:onSubmit (Option ViewActionOrList)})

(type ViewOpenChangeEventMap {:onOpenChange (Option ViewActionOrList)})

(type ViewEventMap
  {
    :onClick (Option ViewActionOrList)
    :onSuccess (Option ViewActionOrList)
    :onRowClick (Option ViewActionOrList)
    :onNodeClick (Option ViewActionOrList)
    :onChange (Option ViewActionOrList)
    :onSubmit (Option ViewActionOrList)
    :onOpenChange (Option ViewActionOrList)})

;; State declarations
(type ViewScalarStateDecl
  {:kind (Union "string" "number" "boolean" "null") :initial (Option Json)})

(type ViewListStateDecl
  {:kind "list" :item (Option ViewStateDecl) :initial (Option (List Json))})

(type ViewObjectStateDecl
  {
    :kind "object"
    :fields (Option (Map String ViewStateDecl))
    :initial (Option (Map String Json))})

(type ViewJsonStateDecl {:kind "json" :initial (Option Json)})

(type ViewComponentStateDecl
  {:kind "component" :initial (Option (Union ViewNode Unit))})

(type ViewStateDecl
  (Union
    ViewScalarStateDecl
    ViewListStateDecl
    ViewObjectStateDecl
    ViewJsonStateDecl
    ViewComponentStateDecl))

;; View node support values
(type ViewTableColumn
  {
    :key String
    :label (Option String)
    :kind (Option (Union "text" "status" "severity" "priority" "date" "mono"))})

(type ViewTableFilter
  {
    :key String
    :label (Option String)
    :placeholder (Option String)
    :op (Option (Union "ilike" "like" "=" "!=" ">" ">=" "<" "<="))})

(type ViewTableSort {:key String :direction (Option (Union "asc" "desc"))})

(type ViewChartSeries
  {:dataKey String :label (Option String) :color (Option String)})

(type ViewSelectOptionValue {:value String :label (Option String)})

;; ViewSpec envelope
(type ViewQueryInlineBinding
  {
    :query Json
    :params (Option (Map String Json))
    :dependsOn (Option (List String))})

(type ViewQueryRefBinding
  {
    :queryRef String
    :params (Option (Map String Json))
    :dependsOn (Option (List String))})

(type ViewQueryBinding (Union ViewQueryInlineBinding ViewQueryRefBinding))

(type ViewInputParam
  {:type String :description (Option String) :default (Option Json)})

(type ViewTheme
  {
    :background (Option String)
    :foreground (Option String)
    :accent (Option String)
    :accentForeground (Option String)
    :muted (Option String)
    :border (Option String)
    :fontFamily (Option String)})

(type ViewCapabilities
  {
    :toolCall (Option Bool)
    :filePicker (Option Bool)
    :displayMode (Option Bool)
    :fetch (Option Bool)
    :sendMessage (Option Bool)
    :updateContext (Option Bool)})

(type ViewSpecMarker {:version "2"})

(type ViewSpec
  {
    :$viewSpec (Option ViewSpecMarker)
    :description (Option String)
    :input (Option (Map String ViewInputParam))
    :state (Option (Map String ViewStateDecl))
    :queries (Option (Map String ViewQueryBinding))
    :defs (Option (Map String ViewNode))
    :theme (Option ViewTheme)
    :capabilities (Option ViewCapabilities)
    :onMount (Option ViewActionOrList)
    :keyBindings (Option (Map String ViewActionOrList))
    :root ViewNode})

(type ViewActionOrList (Union ViewAction (List ViewAction)))

(define protocol
  {:name "ViewSpec" :imports [["ViewNode" "from" "ViewNode" "ViewNodeSchema"]]})

(define view-expr-source
  {
    :extensions
      {
        :view/expr-source
          {
            :sigils
              [
                ["$state" "state"]
                ["$query" "query"]
                ["$input" "input"]
                ["$row" "row"]
                ["$db" "db"]
                ["$item" "item"]
                ["$index" "index"]
                ["$event" "event"]
                ["$result" "result"]
                ["$error" "error"]
                ["$host" "host"]]}}})

(define view-set-state-action
  {
    :extensions
      {
        :view/action
          {
            :form "set-state"
            :discriminator-field "action"
            :tag "setState"
            :callbacks
              [
                ["on-success" "onSuccess"]
                ["on-error" "onError"]
                ["on-finally" "onFinally"]]
            :positional [["key" "string"] ["value" "expr"]]}}})

(define view-patch-state-action
  {
    :extensions
      {
        :view/action
          {
            :form "patch-state"
            :discriminator-field "action"
            :tag "patchState"
            :callbacks
              [
                ["on-success" "onSuccess"]
                ["on-error" "onError"]
                ["on-finally" "onFinally"]]
            :positional [["key" "string"] ["value" "expr"]]}}})

(define view-toggle-state-action
  {
    :extensions
      {
        :view/action
          {
            :form "toggle-state"
            :discriminator-field "action"
            :tag "toggleState"
            :callbacks
              [
                ["on-success" "onSuccess"]
                ["on-error" "onError"]
                ["on-finally" "onFinally"]]
            :positional [["key" "string"]]}}})

(define view-run-query-action
  {
    :extensions
      {
        :view/action
          {
            :form "run-query"
            :discriminator-field "action"
            :tag "runQuery"
            :callbacks
              [
                ["on-success" "onSuccess"]
                ["on-error" "onError"]
                ["on-finally" "onFinally"]]
            :positional [["query" "string"]]}}})

(define view-run-queries-action
  {
    :extensions
      {
        :view/action
          {
            :form "run-queries"
            :discriminator-field "action"
            :tag "runQueries"
            :callbacks
              [
                ["on-success" "onSuccess"]
                ["on-error" "onError"]
                ["on-finally" "onFinally"]]
            :positional [["queries" "string-list"]]}}})

(define view-navigate-action
  {
    :extensions
      {
        :view/action
          {
            :form "navigate"
            :discriminator-field "action"
            :tag "navigate"
            :callbacks
              [
                ["on-success" "onSuccess"]
                ["on-error" "onError"]
                ["on-finally" "onFinally"]]
            :positional [["path" "expr"]]}}})

(define view-show-toast-action
  {
    :extensions
      {
        :view/action
          {
            :form "show-toast"
            :discriminator-field "action"
            :tag "showToast"
            :callbacks
              [
                ["on-success" "onSuccess"]
                ["on-error" "onError"]
                ["on-finally" "onFinally"]]
            :positional [["message" "expr"]]
            :keywords
              [
                ["description" "description" "expr" "optional"]
                ["variant" "variant" "literal" "optional"]
                ["duration" "duration" "literal" "optional"]]}}})

(define view-open-dialog-action
  {
    :extensions
      {
        :view/action
          {
            :form "open-dialog"
            :discriminator-field "action"
            :tag "openDialog"
            :callbacks
              [
                ["on-success" "onSuccess"]
                ["on-error" "onError"]
                ["on-finally" "onFinally"]]
            :positional [["dialogId" "string"]]}}})

(define view-close-dialog-action
  {
    :extensions
      {
        :view/action
          {
            :form "close-dialog"
            :discriminator-field "action"
            :tag "closeDialog"
            :callbacks
              [
                ["on-success" "onSuccess"]
                ["on-error" "onError"]
                ["on-finally" "onFinally"]]
            :positional [["dialogId" "string" "optional"]]}}})

(define view-emit-action
  {
    :extensions
      {
        :view/action
          {
            :form "emit"
            :discriminator-field "action"
            :tag "emit"
            :callbacks
              [
                ["on-success" "onSuccess"]
                ["on-error" "onError"]
                ["on-finally" "onFinally"]]
            :positional [["event" "string"] ["payload" "expr" "optional"]]}}})

(define view-execute-action-action
  {
    :extensions
      {
        :view/action
          {
            :form "execute-action"
            :discriminator-field "action"
            :tag "executeAction"
            :callbacks
              [
                ["on-success" "onSuccess"]
                ["on-error" "onError"]
                ["on-finally" "onFinally"]]
            :positional [["actionRef" "string"] ["entityId" "expr" "optional"]]
            :keywords [["parameters" "parameters" "json" "optional"]]}}})

(define view-fetch-action
  {
    :extensions
      {
        :view/action
          {
            :form "fetch"
            :discriminator-field "action"
            :tag "fetch"
            :callbacks
              [
                ["on-success" "onSuccess"]
                ["on-error" "onError"]
                ["on-finally" "onFinally"]]
            :positional [["url" "expr"]]
            :keywords
              [
                ["method" "method" "literal" "optional"]
                ["headers" "headers" "json" "optional"]
                ["body" "body" "json" "optional"]]}}})

(define view-tool-call-action
  {
    :extensions
      {
        :view/action
          {
            :form "tool-call"
            :discriminator-field "action"
            :tag "toolCall"
            :callbacks
              [
                ["on-success" "onSuccess"]
                ["on-error" "onError"]
                ["on-finally" "onFinally"]]
            :positional [["tool" "expr"]]
            :keywords [["arguments" "arguments" "json" "optional"]]}}})

(define view-request-display-mode-action
  {
    :extensions
      {
        :view/action
          {
            :form "request-display-mode"
            :discriminator-field "action"
            :tag "requestDisplayMode"
            :callbacks
              [
                ["on-success" "onSuccess"]
                ["on-error" "onError"]
                ["on-finally" "onFinally"]]
            :positional [["mode" "literal"]]}}})

(define view-update-context-action
  {
    :extensions
      {
        :view/action
          {
            :form "update-context"
            :discriminator-field "action"
            :tag "updateContext"
            :callbacks
              [
                ["on-success" "onSuccess"]
                ["on-error" "onError"]
                ["on-finally" "onFinally"]]
            :keywords
              [
                ["content" "content" "expr" "optional"]
                ["structured-content" "structuredContent" "json" "optional"]]}}})

(define view-send-message-action
  {
    :extensions
      {
        :view/action
          {
            :form "send-message"
            :discriminator-field "action"
            :tag "sendMessage"
            :callbacks
              [
                ["on-success" "onSuccess"]
                ["on-error" "onError"]
                ["on-finally" "onFinally"]]
            :positional [["content" "expr"]]}}})

(define view-open-file-picker-action
  {
    :extensions
      {
        :view/action
          {
            :form "open-file-picker"
            :discriminator-field "action"
            :tag "openFilePicker"
            :callbacks
              [
                ["on-success" "onSuccess"]
                ["on-error" "onError"]
                ["on-finally" "onFinally"]]
            :keywords
              [
                ["accept" "accept" "literal" "optional"]
                ["multiple" "multiple" "literal" "optional"]
                ["max-size" "maxSize" "literal" "optional"]]}}})
