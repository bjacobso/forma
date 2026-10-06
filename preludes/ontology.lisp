; Ontology forms are typed functions from authored syntax to canonical IR.
; Types define payload contracts; form patterns define bindings and editor shapes.
; Ordinary helpers supply scopes, validation and projections.
;
; (entity Employee {:name String :department (Id Department) :active (Option Bool)})
; (seed Employee "employee:ada" {:name "Ada" :department "department:engineering"})
; (query employees :from Employee :select [name department])
; Canonical domain forms. Their type and projection definitions are the source of truth.
(type
  EntityFieldIR
  {
    :name Keyword
    :type Type
    :required Bool
    :indexed Bool
    :description (Option String)
    :default (Option Json)})
(type
  EntityIR
  {
    :kind "Entity"
    :name Symbol
    :fields (List EntityFieldIR)
    :doc (Option String)
    :role (Option String)
    :idPattern (Option String)})
(type
  RelationIR
  {
    :kind "Relation"
    :name Symbol
    :source Symbol
    :target Symbol
    :fields (List EntityFieldIR)})
(type
  RecordIR
  {
    :kind "Record"
    :name String
    :id String
    :entity Symbol
    :fields (Map String Json)})
(type
  LinkIR
  {
    :kind "Link"
    :name String
    :relation Symbol
    :source String
    :target String
    :sourceId String
    :targetId String
    :fields (Map String Json)})
(type
  SystemAttributeIR
  {
    :kind "SystemAttribute"
    :name Symbol
    :valueType Type
    :required Bool
    :doc (Option String)})
(define optional-type? [t] (and (list? t) (= (str (first t)) "Option")))
(define field-base-type [t] (type/base (if (optional-type? t) (nth t 1) t)))
(define
  fields->ir
  [owner fields]
  (map
    (fn
      [[key t]]
      {
        :name (keyword owner key)
        :type (field-base-type t)
        :required (not (optional-type? t))
        :indexed (meta t :indexed false)
        :description (meta t :doc nil)
        :default
          (if
            (contains? (type/metadata t) :default)
            (Some (meta t :default nil))
            None)})
    fields))
(define
  assignments->ir
  [owner fields]
  (reduce
    (fn
      [record [key value]]
      (assoc record (keyword/name (keyword owner key)) value))
    {}
    fields))
(type
  MetaEntityIR
  {
    :kind "MetaEntity"
    :name Symbol
    :fields (List EntityFieldIR)
    :doc (Option String)
    :role (Option String)
    :idPattern (Option String)})
(type EntityDeclarationIR (Union EntityIR MetaEntityIR))
(form
  (entity name fields {:keys [doc role id-pattern tier]})
  "A named record of attributes."
  :types
    {
      :name (Declares SchemaDecl)
      :fields (Record Type)
      :doc (Option String)
      :role (Option String)
      :id-pattern (Option String)
      :tier (Option (Union :user :meta))}
  :ir EntityDeclarationIR
  {
    :kind (if (= tier :meta) "MetaEntity" "Entity")
    :name name
    :fields (fields->ir name fields)
    :doc doc
    :role role
    :idPattern id-pattern})
(form
  (relation name source target fields)
  "A typed relation between entities."
  :types
    {
      :name (Declares RelationDef)
      :source (Refers SchemaDecl)
      :target (Refers SchemaDecl)
      :fields (Record Type)}
  :ir RelationIR
  {
    :kind "Relation"
    :name name
    :source source
    :target target
    :fields (fields->ir name fields)})
(define
  seed-row
  [owner]
  (reduce
    (fn
      [row key]
      (assoc
        row
        (keyword owner key)
        (type/base (meta/get (declaration-fields owner) key))))
    {}
    (keys (declaration-fields owner))))
(define
  seed-values
  [owner fields]
  (let
    [
      provided
      (reduce
        (fn [record [key value]] (assoc record (keyword owner key) value))
        {}
        fields)
      schema
      (declaration-fields owner)]
    (reduce
      (fn
        [record key]
        (let
          [
            metadata
            (type/metadata (meta/get schema key))
            attribute
            (keyword owner key)]
          (if
            (and
              (= (contains? record attribute) false)
              (contains? metadata :default))
            (assoc record attribute (get metadata :default))
            record)))
      provided
      (keys schema))))
(define
  seed-assignments
  [owner fields]
  (let
    [values (seed-values owner fields)]
    (reduce
      (fn [record key] (assoc record (keyword/name key) (meta/get values key)))
      {}
      (keys values))))
(form
  (seed entity id fields)
  "Seed data for an entity."
  :types
    {
      :entity (Refers SchemaDecl)
      :id (Declares RecordDef String)
      :fields (Record Json)}
  :ir RecordIR
  :check
    (fn
      [{:keys [entity fields]}]
      (schema/validate-record (seed-row entity) (seed-values entity fields)))
  :type RecordDef
  {
    :kind "Record"
    :name id
    :id id
    :entity entity
    :fields (seed-assignments entity fields)})
(form
  (link relation source target fields)
  "A relation instance."
  :types
    {
      :relation (Refers RelationDef)
      :source String
      :target String
      :fields (Record Json)}
  :ir LinkIR
  :check
    (fn
      [{:keys [relation source target fields]}]
      (concat
        (schema/validate-record
          (seed-row relation)
          (seed-values relation fields))
        (schema/validate-record
          {
            :source
              (quasiquote (Id (unquote (declaration-hole relation :source))))
            :target
              (quasiquote (Id (unquote (declaration-hole relation :target))))}
          {:source source :target target})))
  :type LinkDef
  {
    :kind "Link"
    :name (str relation ":" source ":" target)
    :relation relation
    :source source
    :target target
    :sourceId source
    :targetId target
    :fields (seed-assignments relation fields)})
(form
  (attribute name value-type {:keys [doc]})
  "A shared attribute."
  :types {:name (Declares SchemaDecl) :value-type Type :doc (Option String)}
  :ir SystemAttributeIR
  {
    :kind "SystemAttribute"
    :name name
    :valueType (field-base-type value-type)
    :required (not (optional-type? value-type))
    :doc doc})
(type
  QueryIR
  {
    :kind "Query"
    :name Symbol
    :from Symbol
    :where (Option RuntimeExpr)
    :datalog (Option RuntimeExpr)
    :select (List Keyword)})
(define
  entity-fields
  [entity]
  (let
    [
      fields
      (declaration-fields entity)
      row
      (reduce
        (fn
          [row key]
          (assoc row (keyword key) (type/base (meta/get fields key))))
        {}
        (keys fields))]
    (assoc
      (assoc
        (reduce
          (fn [scope key] (assoc scope key (type/base (meta/get fields key))))
          {}
          (keys fields))
        (str entity)
        row)
      :it
      row)))
(form
  (query name {:keys [from where select]})
  "A named read over one entity."
  :types
    {
      :name (Declares QueryDef)
      :from (Refers SchemaDecl)
      :where (Option (Expr Bool))
      :select (Option (List Symbol))}
  :scope {:where (fn [{:keys [from]}] (entity-fields from))}
  :type (fn [{:keys [from select]}] (List (row-of from select)))
  :ir QueryIR
  {
    :kind "Query"
    :name name
    :from from
    :where where
    :select (map (fn [field] (keyword from field)) (or select []))})

; Domain projections are ordinary functions over typed syntax holes.
(type
  WorkspaceIR
  {
    :kind "Workspace"
    :name Symbol
    :title (Option String)
    :persona (Option String)
    :subject (Option Symbol)
    :home (Option Symbol)
    :views (List Symbol)})
(form
  (workspace name {:keys [title persona subject home views]})
  :types
    {
      :name (Declares WorkspaceDef)
      :title (Option String)
      :persona (Option String)
      :subject (Option Symbol)
      :home (Option (Refers ViewDef))
      :views (Option (List (Refers ViewDef)))}
  :ir WorkspaceIR
  {
    :kind "Workspace"
    :name name
    :title title
    :persona persona
    :subject subject
    :home home
    :views (or views [])})
(type
  IdentityDeclarationIR
  {
    :kind "IdentityDeclaration"
    :identityKind String
    :name Symbol
    :description (Option String)
    :member (Option Symbol)
    :group (Option Symbol)
    :principal (Option Symbol)
    :resource (Option Symbol)
    :resolver (Option RuntimeExpr)})
(form
  (identity name
    {:keys [kind description member group principal resource resolver]})
  :types
    {
      :name (Declares IdentityDef)
      :kind (Option (Union :role :group :membership :contextual-role))
      :description (Option String)
      :member (Option Symbol)
      :group (Option (Refers IdentityDef))
      :principal (Option (Refers IdentityDef))
      :resource (Option (Refers SchemaDecl))
      :resolver (Option Syntax)}
  :ir IdentityDeclarationIR
  {
    :kind "IdentityDeclaration"
    :identityKind (keyword/name (or kind :role))
    :name name
    :description description
    :member member
    :group group
    :principal principal
    :resource resource
    :resolver resolver})
(type
  PermissionDeclarationIR
  {
    :kind "PermissionDeclaration"
    :name Symbol
    :principal Symbol
    :action Symbol
    :resource Symbol
    :effect String
    :condition (Option RuntimeExpr)
    :description (Option String)})
(form
  (permission name
    {:keys [principal action resource effect condition description]})
  :types
    {
      :name (Declares PermissionDef)
      :principal (Refers IdentityDef)
      :action (Refers ActionDef)
      :resource (Refers SchemaDecl)
      :effect (Option (Union :allow :deny))
      :condition (Option (Expr Bool))
      :description (Option String)}
  :ir PermissionDeclarationIR
  {
    :kind "PermissionDeclaration"
    :name name
    :principal principal
    :action action
    :resource resource
    :effect (keyword/name (or effect :allow))
    :condition condition
    :description description})
(type TriggerIR {:kind "Trigger" :triggerKind String :entity Symbol})
(type process-trigger TriggerIR)
(form
  (process-trigger/on-create entity)
  :types {:entity (Refers SchemaDecl)}
  :ir TriggerIR
  {:kind "Trigger" :triggerKind "on-create" :entity entity})
(form
  (process-trigger/on-update entity)
  :types {:entity (Refers SchemaDecl)}
  :ir TriggerIR
  {:kind "Trigger" :triggerKind "on-update" :entity entity})
(form
  (process-trigger/on-delete entity)
  :types {:entity (Refers SchemaDecl)}
  :ir TriggerIR
  {:kind "Trigger" :triggerKind "on-delete" :entity entity})
(type ProcessInputIR {:name String :expr RuntimeExpr})
(type
  ProcessNodeIR
  {
    :kind "Node"
    :id Symbol
    :action (Option Symbol)
    :actionRef (Option {:kind "Action" :name Symbol})
    :join (Option String)
    :fanOut (Option String)
    :inputs (List ProcessInputIR)})
(type
  ProcessEdgeIR
  {:kind "Edge" :from Symbol :to Symbol :guard (Option RuntimeExpr)})
(type process-child (Union ProcessNodeIR ProcessEdgeIR))
(define
  expression-entries
  [fields]
  (map (fn [[key value]] {:name (keyword/name key) :expr value}) (or fields [])))
(define reference [kind name] (if (nil? name) nil {:kind kind :name name}))
(form
  (process-child/node id {:keys [action join fan-out input]})
  :types
    {
      :id Symbol
      :action (Option (Refers ActionDef))
      :join (Option String)
      :fan-out (Option String)
      :input (Option (Record Syntax))}
  :ir ProcessNodeIR
  {
    :kind "Node"
    :id id
    :action action
    :actionRef (reference "Action" action)
    :join join
    :fanOut fan-out
    :inputs (expression-entries input)})
(form
  (process-child/edge from to {:keys [guard]})
  :types {:from Symbol :to Symbol :guard (Option (Expr Bool))}
  :ir ProcessEdgeIR
  {:kind "Edge" :from from :to to :guard guard})
(type
  ProcessIR
  {
    :kind "Process"
    :name Symbol
    :description (Option String)
    :trigger TriggerIR
    :nodes (List ProcessNodeIR)
    :edges (List ProcessEdgeIR)})
(define
  children-of-kind
  [kind children]
  (filter (fn [child] (= child.kind kind)) children))
(define
  unique-values
  [values]
  (reduce
    (fn [unique value] (if (contains? unique value) unique (conj unique value)))
    []
    values))
(define
  graph/reachable?
  [edges from to visited]
  (if
    (= from to)
    true
    (if
      (contains? visited from)
      false
      (reduce
        (fn
          [found edge]
          (or
            found
            (and
              (= edge.from from)
              (graph/reachable? edges edge.to to (conj visited from)))))
        false
        edges))))
(define
  graph/cycle-diagnostics
  [edges]
  (reduce
    (fn
      [diagnostics edge]
      (if
        (graph/reachable? edges edge.to edge.from [])
        (conj
          diagnostics
          {
            :severity :error
            :message
              (str "Dependency cycle involving " edge.from " and " edge.to)})
        diagnostics))
    []
    edges))
(define
  process/check
  [children]
  (let
    [
      nodes
      (map (fn [node] node.id) (children-of-kind "Node" children))
      edges
      (children-of-kind "Edge" children)
      duplicates
      (if
        (= (count nodes) (count (unique-values nodes)))
        []
        [{:severity :error :message "Duplicate process node id"}])]
    (reduce
      (fn
        [diagnostics edge]
        (concat
          diagnostics
          (if
            (or (= edge.from (quote start)) (contains? nodes edge.from))
            []
            [
              {
                :severity :error
                :message (str "Unknown process node " edge.from)}])
          (if
            (contains? nodes edge.to)
            []
            [{:severity :error :message (str "Unknown process node " edge.to)}])))
      (concat duplicates (graph/cycle-diagnostics edges))
      edges)))
(form
  (process name {:keys [description trigger]} child ...)
  :types
    {
      :name (Declares ProcessDef)
      :description (Option String)
      :trigger process-trigger
      :child (List process-child)}
  :check (fn [{:keys [child]}] (process/check child))
  :scope {:child (fn [{:keys [child]}] (process/scope child))}
  :ir ProcessIR
  {
    :kind "Process"
    :name name
    :description description
    :trigger trigger
    :nodes (children-of-kind "Node" child)
    :edges (children-of-kind "Edge" child)})
(type DocumentOptionIR {:kind "Option" :value String :label String})
(type document-option DocumentOptionIR)
(form
  (document-option/option value label)
  :types {:value String :label String}
  :ir DocumentOptionIR
  {:kind "Option" :value value :label label})
(type
  AttributeBindingIR
  {
    :kind "AttributeBinding"
    :attribute Keyword
    :entity Symbol
    :transform (Option String)
    :cardinality (Option String)})
(define
  binding/key
  [owner field]
  (first
    (filter
      (fn
        [key]
        (or
          (= (str key) field)
          (=
            (nth (split (str key) "/") (- (count (split (str key) "/")) 1))
            field)))
      (keys (declaration-fields owner)))))
(define
  binding/check
  [binding]
  (if
    (nil? binding)
    []
    (let
      [
        parts
        (split (str binding) ".")
        owner
        (sym (first parts))
        field
        (nth parts 1)]
      (if
        (and (= (count parts) 2) (not (nil? (binding/key owner field))))
        []
        [
          {
            :severity :error
            :slot :bind
            :message (str "Unknown entity attribute " binding)}]))))
(define
  attribute-binding
  [binding transform cardinality]
  (if
    (nil? binding)
    nil
    (let
      [
        parts
        (split (str binding) ".")
        owner
        (sym (first parts))
        field
        (binding/key owner (nth parts 1))]
      {
        :kind "AttributeBinding"
        :entity owner
        :attribute (keyword owner field)
        :transform (if (nil? transform) nil (keyword/name transform))
        :cardinality (if (nil? cardinality) nil (keyword/name cardinality))})))
(type
  DocumentFieldIR
  {
    :kind "Field"
    :type String
    :path Keyword
    :label (Option String)
    :description (Option String)
    :content (Option String)
    :required Bool
    :binding (Option AttributeBindingIR)
    :options (List DocumentOptionIR)})
(type document-field DocumentFieldIR)
(form
  (document-field/text path label
    {:keys [description required bind transform cardinality]}
    option
    ...)
  :types
    {
      :path Keyword
      :label String
      :description (Option String)
      :required (Option Bool)
      :bind (Option Symbol)
      :transform
        (Option
          (Union :identity :string :number :boolean :date :datetime :json :ref))
      :cardinality (Option (Union :one :many))
      :option (List document-option)}
  :check (fn [{:keys [bind]}] (binding/check bind))
  :ir DocumentFieldIR
  {
    :kind "Field"
    :type "text"
    :path path
    :label label
    :description description
    :required (or required false)
    :binding (attribute-binding bind transform cardinality)
    :options option})
(form
  (document-field/date path label
    {:keys [description required bind transform cardinality]}
    option
    ...)
  :types
    {
      :path Keyword
      :label String
      :description (Option String)
      :required (Option Bool)
      :bind (Option Symbol)
      :transform
        (Option
          (Union :identity :string :number :boolean :date :datetime :json :ref))
      :cardinality (Option (Union :one :many))
      :option (List document-option)}
  :check (fn [{:keys [bind]}] (binding/check bind))
  :ir DocumentFieldIR
  {
    :kind "Field"
    :type "date"
    :path path
    :label label
    :description description
    :required (or required false)
    :binding (attribute-binding bind transform cardinality)
    :options option})
(form
  (document-field/number path label
    {:keys [description required bind transform cardinality]}
    option
    ...)
  :types
    {
      :path Keyword
      :label String
      :description (Option String)
      :required (Option Bool)
      :bind (Option Symbol)
      :transform
        (Option
          (Union :identity :string :number :boolean :date :datetime :json :ref))
      :cardinality (Option (Union :one :many))
      :option (List document-option)}
  :check (fn [{:keys [bind]}] (binding/check bind))
  :ir DocumentFieldIR
  {
    :kind "Field"
    :type "number"
    :path path
    :label label
    :description description
    :required (or required false)
    :binding (attribute-binding bind transform cardinality)
    :options option})
(form
  (document-field/checkbox path label
    {:keys [description required bind transform cardinality]}
    option
    ...)
  :types
    {
      :path Keyword
      :label String
      :description (Option String)
      :required (Option Bool)
      :bind (Option Symbol)
      :transform
        (Option
          (Union :identity :string :number :boolean :date :datetime :json :ref))
      :cardinality (Option (Union :one :many))
      :option (List document-option)}
  :check (fn [{:keys [bind]}] (binding/check bind))
  :ir DocumentFieldIR
  {
    :kind "Field"
    :type "checkbox"
    :path path
    :label label
    :description description
    :required (or required false)
    :binding (attribute-binding bind transform cardinality)
    :options option})
(form
  (document-field/select path label
    {:keys [description required bind transform cardinality]}
    option
    ...)
  :types
    {
      :path Keyword
      :label String
      :description (Option String)
      :required (Option Bool)
      :bind (Option Symbol)
      :transform
        (Option
          (Union :identity :string :number :boolean :date :datetime :json :ref))
      :cardinality (Option (Union :one :many))
      :option (List document-option)}
  :check (fn [{:keys [bind]}] (binding/check bind))
  :ir DocumentFieldIR
  {
    :kind "Field"
    :type "select"
    :path path
    :label label
    :description description
    :required (or required false)
    :binding (attribute-binding bind transform cardinality)
    :options option})
(form
  (document-field/textarea path label
    {:keys [description required bind transform cardinality]}
    option
    ...)
  :types
    {
      :path Keyword
      :label String
      :description (Option String)
      :required (Option Bool)
      :bind (Option Symbol)
      :transform
        (Option
          (Union :identity :string :number :boolean :date :datetime :json :ref))
      :cardinality (Option (Union :one :many))
      :option (List document-option)}
  :check (fn [{:keys [bind]}] (binding/check bind))
  :ir DocumentFieldIR
  {
    :kind "Field"
    :type "textarea"
    :path path
    :label label
    :description description
    :required (or required false)
    :binding (attribute-binding bind transform cardinality)
    :options option})
(form
  (document-field/signature path label
    {:keys [description required bind transform cardinality]}
    option
    ...)
  :types
    {
      :path Keyword
      :label String
      :description (Option String)
      :required (Option Bool)
      :bind (Option Symbol)
      :transform
        (Option
          (Union :identity :string :number :boolean :date :datetime :json :ref))
      :cardinality (Option (Union :one :many))
      :option (List document-option)}
  :check (fn [{:keys [bind]}] (binding/check bind))
  :ir DocumentFieldIR
  {
    :kind "Field"
    :type "signature"
    :path path
    :label label
    :description description
    :required (or required false)
    :binding (attribute-binding bind transform cardinality)
    :options option})
(form
  (document-field/file path label
    {:keys [description required bind transform cardinality]}
    option
    ...)
  :types
    {
      :path Keyword
      :label String
      :description (Option String)
      :required (Option Bool)
      :bind (Option Symbol)
      :transform
        (Option
          (Union :identity :string :number :boolean :date :datetime :json :ref))
      :cardinality (Option (Union :one :many))
      :option (List document-option)}
  :check (fn [{:keys [bind]}] (binding/check bind))
  :ir DocumentFieldIR
  {
    :kind "Field"
    :type "file"
    :path path
    :label label
    :description description
    :required (or required false)
    :binding (attribute-binding bind transform cardinality)
    :options option})
(form
  (document-field/email path label
    {:keys [description required bind transform cardinality]}
    option
    ...)
  :types
    {
      :path Keyword
      :label String
      :description (Option String)
      :required (Option Bool)
      :bind (Option Symbol)
      :transform
        (Option
          (Union :identity :string :number :boolean :date :datetime :json :ref))
      :cardinality (Option (Union :one :many))
      :option (List document-option)}
  :check (fn [{:keys [bind]}] (binding/check bind))
  :ir DocumentFieldIR
  {
    :kind "Field"
    :type "email"
    :path path
    :label label
    :description description
    :required (or required false)
    :binding (attribute-binding bind transform cardinality)
    :options option})
(form
  (document-field/phone path label
    {:keys [description required bind transform cardinality]}
    option
    ...)
  :types
    {
      :path Keyword
      :label String
      :description (Option String)
      :required (Option Bool)
      :bind (Option Symbol)
      :transform
        (Option
          (Union :identity :string :number :boolean :date :datetime :json :ref))
      :cardinality (Option (Union :one :many))
      :option (List document-option)}
  :check (fn [{:keys [bind]}] (binding/check bind))
  :ir DocumentFieldIR
  {
    :kind "Field"
    :type "phone"
    :path path
    :label label
    :description description
    :required (or required false)
    :binding (attribute-binding bind transform cardinality)
    :options option})
(form
  (document-field/radio path label
    {:keys [description required bind transform cardinality]}
    option
    ...)
  :types
    {
      :path Keyword
      :label String
      :description (Option String)
      :required (Option Bool)
      :bind (Option Symbol)
      :transform
        (Option
          (Union :identity :string :number :boolean :date :datetime :json :ref))
      :cardinality (Option (Union :one :many))
      :option (List document-option)}
  :check (fn [{:keys [bind]}] (binding/check bind))
  :ir DocumentFieldIR
  {
    :kind "Field"
    :type "radio"
    :path path
    :label label
    :description description
    :required (or required false)
    :binding (attribute-binding bind transform cardinality)
    :options option})
(form
  (document-field/hidden path label
    {:keys [description required bind transform cardinality]}
    option
    ...)
  :types
    {
      :path Keyword
      :label String
      :description (Option String)
      :required (Option Bool)
      :bind (Option Symbol)
      :transform
        (Option
          (Union :identity :string :number :boolean :date :datetime :json :ref))
      :cardinality (Option (Union :one :many))
      :option (List document-option)}
  :check (fn [{:keys [bind]}] (binding/check bind))
  :ir DocumentFieldIR
  {
    :kind "Field"
    :type "hidden"
    :path path
    :label label
    :description description
    :required (or required false)
    :binding (attribute-binding bind transform cardinality)
    :options option})
(form
  (document-field/content path content)
  :types {:path Keyword :content String}
  :ir DocumentFieldIR
  {
    :kind "Field"
    :type "content"
    :path path
    :content content
    :required false
    :options []})
(type
  DocumentCompletionIR
  {
    :kind "CompletionMutation"
    :mutation Symbol
    :mutationRef {:kind "Action" :name Symbol}
    :entity (Option Symbol)
    :entityRef (Option {:kind "Entity" :name Symbol})})
(type document-completion DocumentCompletionIR)
(form
  (document-completion/completion action {:keys [entity]})
  :types {:action (Refers ActionDef) :entity (Option (Refers SchemaDecl))}
  :ir DocumentCompletionIR
  {
    :kind "CompletionMutation"
    :mutation action
    :mutationRef (reference "Action" action)
    :entity entity
    :entityRef (reference "Entity" entity)})
(type
  DocumentPageIR
  {
    :kind "Page"
    :sectionId Symbol
    :assignee Symbol
    :description (Option String)
    :dependsOn (List Symbol)
    :completion (Option DocumentCompletionIR)
    :fields (List DocumentFieldIR)})
(type document-page DocumentPageIR)
(form
  (document-page/page name
    {:keys [assignee description depends-on completion]}
    child
    ...)
  :types
    {
      :name Symbol
      :assignee Symbol
      :description (Option String)
      :depends-on (Option (List Symbol))
      :completion (Option document-completion)
      :child (List document-field)}
  :ir DocumentPageIR
  {
    :kind "Page"
    :sectionId name
    :assignee assignee
    :description description
    :dependsOn (or depends-on [])
    :completion completion
    :fields child})
(define
  document/check
  [pages]
  (let
    [
      sections
      (map (fn [page] page.sectionId) pages)
      fields
      (flat-map (fn [page] (map (fn [field] field.path) page.fields)) pages)
      edges
      (flat-map
        (fn
          [page]
          (map
            (fn [dependency] {:from dependency :to page.sectionId})
            page.dependsOn))
        pages)
      duplicates
      (concat
        (if
          (= (count sections) (count (unique-values sections)))
          []
          [{:severity :error :message "Duplicate document section id"}])
        (if
          (= (count fields) (count (unique-values fields)))
          []
          [{:severity :error :message "Duplicate document field path"}]))]
    (reduce
      (fn
        [diagnostics edge]
        (if
          (contains? sections edge.from)
          diagnostics
          (conj
            diagnostics
            {
              :severity :error
              :message (str "Unknown document dependency " edge.from)})))
      (concat duplicates (graph/cycle-diagnostics edges))
      edges)))
(type
  DocumentIR
  {
    :kind "Document"
    :name Symbol
    :description (Option String)
    :pages (List DocumentPageIR)})
(form
  (document name {:keys [description]} page ...)
  :types
    {
      :name (Declares DocumentDef)
      :description (Option String)
      :page (List document-page)}
  :check (fn [{:keys [page]}] (document/check page))
  :ir DocumentIR
  {:kind "Document" :name name :description description :pages page})
(type TaskInputIR {:name Keyword :type Type :required Bool})
(type
  TaskDefinitionIR
  {
    :kind "TaskDefinition"
    :name Symbol
    :title String
    :description (Option String)
    :documentRef (Option {:kind "Document" :name Symbol})
    :sectionRefs (List Symbol)
    :defaultAssignee (Option Json)
    :guidanceRef (Option Symbol)
    :inputs (List TaskInputIR)
    :scope (Option Json)})
(form
  (task name fields
    {
      :keys
        [title description document sections default-assignee guidance scope]})
  :types
    {
      :name (Declares TaskDef)
      :fields (Record Type)
      :title String
      :description (Option String)
      :document (Option (Refers DocumentDef))
      :sections (Option (List Symbol))
      :default-assignee (Option Json)
      :guidance (Option Symbol)
      :scope (Option Json)}
  :ir TaskDefinitionIR
  {
    :kind "TaskDefinition"
    :name name
    :title title
    :description description
    :documentRef (reference "Document" document)
    :sectionRefs (or sections [])
    :defaultAssignee default-assignee
    :guidanceRef guidance
    :inputs
      (map
        (fn
          [[key t]]
          {
            :name key
            :type (field-base-type t)
            :required (not (optional-type? t))})
        fields)
    :scope scope})
(type
  DocumentRoleLocaleIR
  {
    :kind "Role"
    :name Symbol
    :label (Option String)
    :description (Option String)})
(type
  DocumentSectionLocaleIR
  {
    :kind "Section"
    :name Symbol
    :label (Option String)
    :description (Option String)})
(type
  DocumentFieldLocaleIR
  {
    :kind "LocaleField"
    :path Keyword
    :label (Option String)
    :description (Option String)
    :options (List DocumentOptionIR)})
(type
  document-locale-child
  (Union DocumentRoleLocaleIR DocumentSectionLocaleIR DocumentFieldLocaleIR))
(form
  (document-locale-child/role name {:keys [label description]})
  :types {:name Symbol :label (Option String) :description (Option String)}
  :ir DocumentRoleLocaleIR
  {:kind "Role" :name name :label label :description description})
(form
  (document-locale-child/section name {:keys [label description]})
  :types {:name Symbol :label (Option String) :description (Option String)}
  :ir DocumentSectionLocaleIR
  {:kind "Section" :name name :label label :description description})
(form
  (document-locale-child/field path {:keys [label description]} option ...)
  :types
    {
      :path Keyword
      :label (Option String)
      :description (Option String)
      :option (List document-option)}
  :ir DocumentFieldLocaleIR
  {
    :kind "LocaleField"
    :path path
    :label label
    :description description
    :options option})
(type
  DocumentLocaleIR
  {
    :kind "DocumentLocale"
    :documentName Symbol
    :documentRef {:kind "Document" :name Symbol}
    :locale String
    :roles (List DocumentRoleLocaleIR)
    :sections (List DocumentSectionLocaleIR)
    :fields (List DocumentFieldLocaleIR)})
(define
  document/raw-option
  [items key]
  (if
    (empty? items)
    nil
    (if
      (= (first items) key)
      (nth items 1)
      (document/raw-option (rest items) key))))
(define
  document/locale-check
  [document children]
  (let
    [
      pages
      (declaration-hole document :page)
      sections
      (map (fn [page] (nth page 1)) pages)
      roles
      (map (fn [page] (document/raw-option page :assignee)) pages)
      fields
      (flat-map
        (fn
          [page]
          (map
            (fn [field] (nth field 1))
            (filter
              (fn
                [field]
                (if
                  (list? field)
                  (if (> (count field) 1) (keyword? (nth field 1)) false)
                  false))
              page)))
        pages)]
    (flat-map
      (fn
        [child]
        (let
          [
            value
            (if (= child.kind "LocaleField") child.path child.name)
            members
            (if
              (= child.kind "Role")
              roles
              (if (= child.kind "Section") sections fields))]
          (if
            (contains? members value)
            []
            [
              {
                :severity :error
                :message (str "Unknown document " child.kind " " value)}])))
      children)))
(form
  (document-locale document locale child ...)
  :type DocumentLocaleDef
  :types
    {
      :document (Refers DocumentDef)
      :locale String
      :child (List document-locale-child)}
  :check (fn [{:keys [document child]}] (document/locale-check document child))
  :ir DocumentLocaleIR
  {
    :kind "DocumentLocale"
    :documentName document
    :documentRef (reference "Document" document)
    :locale locale
    :roles (children-of-kind "Role" child)
    :sections (children-of-kind "Section" child)
    :fields (children-of-kind "LocaleField" child)})
(type
  DocumentLocalizedIR
  {
    :kind "DocumentLocalized"
    :documentName Symbol
    :documentRef {:kind "Document" :name Symbol}
    :locales (List String)
    :defaultLocale (Option String)})
(form
  (document-localized document locales {:keys [default-locale]})
  :type DocumentLocalizedDef
  :types
    {
      :document (Refers DocumentDef)
      :locales (List String)
      :default-locale (Option String)}
  :ir DocumentLocalizedIR
  :check
    (fn
      [{:keys [locales default-locale]}]
      (if
        (or (nil? default-locale) (contains? locales default-locale))
        []
        [
          {
            :severity :error
            :slot :default-locale
            :message "Default locale must belong to locales"}]))
  {
    :kind "DocumentLocalized"
    :documentName document
    :documentRef (reference "Document" document)
    :locales locales
    :defaultLocale default-locale})
(type PdfSetIR {:kind "Set" :pdfField String :value Json})
(type pdf-set PdfSetIR)
(form
  (pdf-set/set field value)
  :types {:field String :value Json}
  :ir PdfSetIR
  {:kind "Set" :pdfField field :value value})
(type PdfCaseIR {:kind "Case" :when String :assignments (List PdfSetIR)})
(type pdf-case PdfCaseIR)
(form
  (pdf-case/case value assignment ...)
  :types {:value String :assignment (List pdf-set)}
  :ir PdfCaseIR
  {:kind "Case" :when value :assignments assignment})
(type
  PdfDirectIR
  {:kind "Direct" :source Keyword :pdfField String :transform (Option Symbol)})
(type
  PdfComputedIR
  {
    :kind "Computed"
    :expr RuntimeExpr
    :pdfField String
    :transform (Option Symbol)})
(type PdfSwitchIR {:kind "Switch" :source Keyword :cases (List PdfCaseIR)})
(type PdfMappingEntryIR (Union PdfDirectIR PdfComputedIR PdfSwitchIR))
(type pdf-entry PdfMappingEntryIR)
(form
  (pdf-entry/direct source field {:keys [transform]})
  :types {:source Keyword :field String :transform (Option Symbol)}
  :ir PdfDirectIR
  {:kind "Direct" :source source :pdfField field :transform transform})
(form
  (pdf-entry/computed expression field {:keys [transform]})
  :types {:expression Syntax :field String :transform (Option Symbol)}
  :ir PdfComputedIR
  {:kind "Computed" :expr expression :pdfField field :transform transform})
(form
  (pdf-entry/switch source case ...)
  :types {:source Keyword :case (List pdf-case)}
  :ir PdfSwitchIR
  {:kind "Switch" :source source :cases case})
(type
  PdfMappingIR
  {
    :kind "PdfMapping"
    :name Symbol
    :displayName (Option String)
    :description (Option String)
    :templateBlob String
    :templateFile (Option String)
    :templateFilename (Option String)
    :documentName (Option Symbol)
    :documentRef (Option {:kind "Document" :name Symbol})
    :mappings (List PdfMappingEntryIR)})
(form
  (pdf-mapping name
    {
      :keys
        [
          display-name
          description
          template-blob
          template-file
          template-filename
          document]}
    mapping
    ...)
  :types
    {
      :name (Declares PdfMappingDef)
      :display-name (Option String)
      :description (Option String)
      :template-blob String
      :template-file (Option String)
      :template-filename (Option String)
      :document (Option (Refers DocumentDef))
      :mapping (List pdf-entry)}
  :ir PdfMappingIR
  {
    :kind "PdfMapping"
    :name name
    :displayName display-name
    :description description
    :templateBlob template-blob
    :templateFile template-file
    :templateFilename template-filename
    :documentName document
    :documentRef (reference "Document" document)
    :mappings mapping})

; Constraints share entity scope with queries. Resolution parameters are records.
(type ResolutionInputIR {:param String :runtimeSource RuntimeExpr})
(type
  ResolutionIR
  {
    :kind "Resolution"
    :label String
    :action Symbol
    :actionRef {:kind "Action" :name Symbol}
    :autoInvoke Bool
    :inputs (List ResolutionInputIR)})
(type constraint-child (Union ResolutionIR ConstraintTaskAssignmentIR))
(form
  (constraint-child/resolution label action {:keys [auto input]})
  :types
    {
      :label String
      :action (Refers ActionDef)
      :auto (Option Bool)
      :input (Option (Record Syntax))}
  :ir ResolutionIR
  {
    :kind "Resolution"
    :label label
    :action action
    :actionRef (reference "Action" action)
    :autoInvoke (or auto false)
    :inputs
      (map
        (fn
          [[key expression]]
          {:param (keyword/name key) :runtimeSource expression})
        (or input []))})
(type
  ConstraintTaskAssignmentIR
  {
    :kind "TaskAssignment"
    :role Symbol
    :priority (Option String)
    :title (Option RuntimeExpr)
    :body (Option RuntimeExpr)})
(form
  (constraint-child/assigns-task-to role {:keys [priority title body]})
  :types
    {
      :role Symbol
      :priority (Option String)
      :title (Option (Expr String))
      :body (Option (Expr String))}
  :ir ConstraintTaskAssignmentIR
  {:kind "TaskAssignment" :role role :priority priority :title title :body body})
(define
  scope/merge
  [left right]
  (reduce
    (fn [scope [key type]] (assoc scope key type))
    left
    (meta/entries right)))
(define
  datalog/scope
  [query]
  (let
    [items (sexpr-items query)]
    (if
      (or (= (str (first items)) "not") (= (str (first items)) "not-join"))
      {}
      (reduce
        (fn
          [scope clause]
          (let
            [
              scope
              (scope/merge scope (datalog/scope clause))
              items
              (sexpr-items clause)]
            (if
              (and (= (count items) 3) (keyword? (nth items 1)))
              (let
                [
                  subject
                  (first items)
                  attribute
                  (nth items 1)
                  value
                  (nth items 2)
                  type
                  (if
                    (= attribute :_schema/type)
                    (quote String)
                    (attribute-type attribute))]
                (if
                  (= attribute :_schema/type)
                  (assoc scope (str subject) (list (quote Id) (sym value)))
                  (if
                    (and (symbol? value) (starts-with? (str value) "?"))
                    (assoc scope (str value) (field-base-type type))
                    scope)))
              scope)))
        {}
        items))))
(type
  ConstraintIR
  {
    :kind "Constraint"
    :name Symbol
    :entity Symbol
    :entityRef {:kind "Entity" :name Symbol}
    :severity String
    :description (Option String)
    :category (Option String)
    :when (Option RuntimeExpr)
    :query (Option RuntimeExpr)
    :message RuntimeExpr
    :taskAssignments (List ConstraintTaskAssignmentIR)
    :resolutions (List ResolutionIR)})
(form
  (constraint name
    {:keys [entity severity description category when query message]}
    child
    ...)
  :types
    {
      :name (Declares ConstraintDef)
      :entity (Refers SchemaDecl)
      :severity (Union :error :warning :info)
      :description (Option String)
      :category (Option String)
      :when (Option (Expr Bool))
      :query (Option Syntax)
      :message (Expr String)
      :child (List constraint-child)}
  :scope
    {
      :when (fn [{:keys [entity]}] (entity-fields entity))
      :message
        (fn
          [{:keys [entity query]}]
          (scope/merge (entity-fields entity) (datalog/scope query)))
      :child
        (fn
          [{:keys [entity query]}]
          (scope/merge (entity-fields entity) (datalog/scope query)))}
  :check
    (fn
      [{:keys [when query]}]
      (if
        (= (nil? when) (nil? query))
        [
          {
            :severity :error
            :message "A constraint requires exactly one of :when or :query"}]
        []))
  :ir ConstraintIR
  {
    :kind "Constraint"
    :name name
    :entity entity
    :entityRef (reference "Entity" entity)
    :severity (keyword/name severity)
    :description description
    :category category
    :when when
    :query query
    :message message
    :taskAssignments (children-of-kind "TaskAssignment" child)
    :resolutions (children-of-kind "Resolution" child)})
(type QueryPresetParamIR {:name String :value RuntimeExpr})
(type
  QueryPresetIR
  {
    :kind "QueryPreset"
    :name Symbol
    :queryRef {:kind "Query" :name Symbol}
    :defaults (List QueryPresetParamIR)
    :mergePolicy String})
(form
  (query-preset name query defaults {:keys [merge-policy]})
  :types
    {
      :name (Declares QueryPresetDef)
      :query (Refers QueryDef)
      :defaults (Record Syntax)
      :merge-policy (Option (Union :caller-overrides :preset-overrides))}
  :ir QueryPresetIR
  {
    :kind "QueryPreset"
    :name name
    :queryRef (reference "Query" query)
    :defaults
      (map (fn [[key value]] {:name (keyword/name key) :value value}) defaults)
    :mergePolicy (keyword/name (or merge-policy :caller-overrides))})
(form
  (datalog-query name expression)
  :types {:name (Declares QueryDef) :expression Syntax}
  :ir QueryIR
  {:kind "Query" :name name :from (quote *) :datalog expression :select []})

; A view and an embeddable fragment have one shape. State and inputs use records.
(type
  ViewColumnIR
  {:name Keyword :label (Option String) :expr (Option RuntimeExpr)})
(type view-column ViewColumnIR)
(form
  (view-column/column name {:keys [label expr]})
  :types {:name Keyword :label (Option String) :expr (Option Syntax)}
  :ir ViewColumnIR
  {:name name :label label :expr expr})
(type ViewSortIR {:field Keyword :direction String})
(type
  ViewIR
  {
    :kind "View"
    :name Symbol
    :doc (Option String)
    :query (Option Symbol)
    :queryRef (Option {:kind "Query" :name Symbol})
    :title (Option String)
    :subject (Option Symbol)
    :mode (Option String)
    :fragment Bool
    :emptyState (Option String)
    :where (Option RuntimeExpr)
    :defaultSort (Option ViewSortIR)
    :rowAction (Option RuntimeExpr)
    :columns (List ViewColumnIR)
    :state (Option Json)
    :input (Option Json)
    :queries (Option Json)
    :defs (Option Json)
    :root (Option Json)
    :layout (Option Json)})
(define
  optional-record
  [entries]
  (if
    (nil? entries)
    nil
    (reduce
      (fn [record [key value]] (assoc record (keyword/name key) value))
      {}
      entries)))
(define
  view/sort
  [sort]
  (if
    (nil? sort)
    nil
    {
      :field (keyword (first sort))
      :direction (keyword/name (or (nth sort 1) :asc))}))
(define
  view/defs
  [defs state queries input]
  (if
    (nil? defs)
    nil
    (reduce
      (fn
        [record [key value]]
        (assoc
          record
          (keyword/name key)
          (meta/compile-descriptor-tree "viewspec" value)))
      {}
      defs)))
(form
  (view name
    {
      :keys
        [
          query
          title
          description
          subject
          mode
          fragment
          empty-state
          where
          default-sort
          row-action
          state
          input
          queries
          defs
          layout]}
    column
    ...)
  :types
    {
      :name (Declares ViewDef)
      :query (Option (Refers QueryDef))
      :title (Option String)
      :description (Option String)
      :subject (Option Symbol)
      :mode (Option String)
      :fragment (Option Bool)
      :empty-state (Option String)
      :where (Option Syntax)
      :default-sort (Option (List Json))
      :row-action (Option Syntax)
      :state (Option (Record Json))
      :input (Option (Record Type))
      :queries (Option (Record Json))
      :defs (Option (Record Syntax))
      :layout (Option Syntax)
      :column (List view-column)}
  :ir ViewIR
  (let
    [
      definition
      (view/defs defs state queries input)
      root
      (meta/compile-descriptor-tree "viewspec" layout)
      root
      (if (or (nil? definition) (nil? root)) root (assoc root :defs definition))]
    {
      :kind "View"
      :name name
      :doc description
      :query query
      :queryRef (reference "Query" query)
      :title title
      :subject subject
      :mode mode
      :fragment (or fragment false)
      :emptyState empty-state
      :where where
      :defaultSort (view/sort default-sort)
      :rowAction row-action
      :columns column
      :state (optional-record state)
      :input (optional-record input)
      :queries (optional-record queries)
      :defs definition
      :root root
      :layout root}))

; Internal action projection. Public operations are a signature plus an ordinary define.
(type ActionInputIR {:name String :type Type :required Bool})
(type
  ActionIR
  {
    :kind "Action"
    :name Symbol
    :inputs (List ActionInputIR)
    :returns Type
    :do RuntimeExpr})
(type (Action a) (Effect a [] [OntologyRuntime]))
(define
  action/effect
  [result]
  (quasiquote (Effect (unquote result) [] [OntologyRuntime])))
(form
  (__action name fields returns effect body checked entities relations documents
    calls)
  :types
    {
      :name (Declares ActionDef)
      :fields (Record Type)
      :returns Type
      :effect Type
      :body Syntax
      :checked (Expr effect)
      :entities (List (Refers SchemaDecl))
      :relations (List (Refers RelationDef))
      :documents (List (Refers DocumentDef))
      :calls (List (Refers ActionDef))}
  :scope
    {
      :checked
        (fn
          [{:keys [fields entities relations calls]}]
          (action/scope fields entities relations calls))}
  :ir ActionIR
  {
    :kind "Action"
    :name name
    :inputs
      (map
        (fn
          [[key type]]
          {
            :name (keyword/name key)
            :type (field-base-type type)
            :required (not (optional-type? type))})
        fields)
    :returns returns
    :do body})
(define
  action/record
  [entity optional]
  (reduce
    (fn
      [record key]
      (let
        [type (meta/get (declaration-fields entity) key)]
        (assoc
          record
          (keyword key)
          (if
            optional
            (list (quote Option) (field-base-type type))
            (type/base type)))))
    {}
    (keys (declaration-fields entity))))
(define
  action/input-type
  [type]
  (if
    (not (empty? (declaration-fields type)))
    (quasiquote
      (unquote (assoc (action/record type false) :id (list (quote Id) type))))
    (quasiquote (unquote type))))
(define
  action/scope
  [fields entities relations calls]
  (let
    [
      inputs
      (reduce
        (fn [scope [key type]] (assoc scope key (action/input-type type)))
        {"emit!" (quote (-> String (Effect Unit [] [OntologyRuntime])))}
        fields)
      inputs
      (reduce
        (fn
          [scope name]
          (let
            [
              fields
              (declaration-hole name :fields)
              returns
              (declaration-hole name :returns)]
            (assoc
              scope
              (str name)
              (concat
                [(quasiquote ->)]
                (map
                  (fn [[key type]] (action/input-type type))
                  (meta/entries fields))
                [(action/effect returns)]))))
        inputs
        calls)
      inputs
      (reduce
        (fn
          [scope relation]
          (assoc
            scope
            (str "__action.link/" relation)
            (quasiquote
              (->
                (Id (unquote (declaration-hole relation :source)))
                (Id (unquote (declaration-hole relation :target)))
                (unquote (action/record relation false))
                (Effect Unit [] [OntologyRuntime])))))
        inputs
        relations)]
    (reduce
      (fn
        [scope entity]
        (let
          [
            scope
            (assoc
              (assoc
                (assoc
                  scope
                  (str "__action.create/" entity)
                  (quasiquote
                    (->
                      (unquote (action/record entity false))
                      (Effect (Id (unquote entity)) [] [OntologyRuntime]))))
                (str "__action.update/" entity)
                (quasiquote
                  (->
                    (Id (unquote entity))
                    (unquote (action/record entity true))
                    (Effect Unit [] [OntologyRuntime]))))
              (str "__action.retract/" entity)
              (quasiquote
                (-> (Id (unquote entity)) (Effect Unit [] [OntologyRuntime]))))]
          (assoc
            (assoc
              scope
              (str "__action.instantiate/" entity)
              (quasiquote
                (->
                  Symbol
                  (Id (unquote entity))
                  (Effect String [] [OntologyRuntime]))))
            (str "__action.task/" entity)
            (quasiquote
              (->
                {
                  :title String
                  :type String
                  :priority String
                  :entity-id (Id (unquote entity))
                  :entity-type String
                  :document-ref String
                  :document-instance-ref String
                  :section-refs (List String)
                  :assignee-role String}
                (Effect String [] [OntologyRuntime]))))))
      inputs
      entities)))
(define
  syntax-option
  [syntax key]
  (let
    [
      state
      (reduce
        (fn
          [state value]
          (if
            state.found
            state
            (if
              state.next
              {:found true :next false :value (Some value)}
              {:found false :next (= value key) :value None})))
        {:found false :next false :value None}
        syntax)]
    state.value))
(define
  process/scope
  [children]
  {
    :outputs
      (reduce
        (fn
          [outputs node]
          (if
            (= (str (first node)) "node")
            (let
              [
                returns
                (match
                  (syntax-option node :action)
                  (Some action)
                  (or (declaration-hole action :returns) (quote Unit))
                  None
                  (quote Unit))]
              (assoc outputs (keyword (nth node 1)) {:action returns}))
            outputs))
        {}
        children)})

; Datalog introduces the variables bound by positive attribute clauses.
(type
  HttpEndpointIR
  {
    :kind "Endpoint"
    :name Symbol
    :method String
    :path String
    :payload (Option Type)
    :query (Map String Type)
    :headers (Map String Type)
    :success Type
    :errors (List Type)
    :openapi (Option Json)})
(type http-endpoint HttpEndpointIR)
(form
  (http-endpoint/endpoint name
    {:keys [method path payload query headers success errors openapi]})
  :types
    {
      :name Symbol
      :method (Union :get :post :put :patch :delete :head :options)
      :path String
      :payload (Option Type)
      :query (Option (Record Type))
      :headers (Option (Record Type))
      :success Type
      :errors (Option (List Type))
      :openapi (Option Json)}
  :ir HttpEndpointIR
  {
    :kind "Endpoint"
    :name name
    :method (upper (keyword/name method))
    :path path
    :payload payload
    :query (or (optional-record query) {})
    :headers (or (optional-record headers) {})
    :success success
    :errors (or errors [])
    :openapi openapi})
(: http/type-check (-> Any (List Any)))
(define
  http/type-check
  [t]
  (if
    (symbol? t)
    (if
      (or
        (contains?
          [
            "String"
            "Int"
            "Number"
            "Bool"
            "Unit"
            "Json"
            "Bytes"
            "DateTime"
            "Duration"]
          (str t))
        (not (nil? (type/kind t))))
      []
      [
        {
          :severity :error
          :code "http/unknown-schema-ref"
          :message (str "Unknown HTTP type " t)}])
    (if
      (map? t)
      (flat-map (fn [[key value]] (http/type-check value)) (meta/entries t))
      (if
        (list? t)
        (if
          (contains? ["List" "Option" "Map" "Union" "Brand"] (str (first t)))
          (flat-map http/type-check (rest t))
          [
            {
              :severity :error
              :code "http/unsupported-type"
              :message (str "Unsupported HTTP type " t)}])
        []))))
(define
  http/path-parameters
  [path]
  (map (fn [part] (first (split part "}"))) (rest (split path "{"))))
(define
  http/api-check
  [path-params endpoints]
  (let
    [
      declared
      (map (fn [[key t]] (keyword/name key)) (or path-params []))
      names
      (map (fn [endpoint] endpoint.name) endpoints)
      routes
      (map (fn [endpoint] (str endpoint.method " " endpoint.path)) endpoints)]
    (concat
      (if
        (= (count names) (count (unique-values names)))
        []
        [
          {
            :severity :error
            :code "http/duplicate-endpoint"
            :message "Duplicate endpoint name"}])
      (if
        (= (count routes) (count (unique-values routes)))
        []
        [
          {
            :severity :error
            :code "http/duplicate-route"
            :message "Duplicate HTTP method and path"}])
      (flat-map (fn [[key t]] (http/type-check t)) (or path-params []))
      (flat-map
        (fn
          [endpoint]
          (concat
            (flat-map
              (fn
                [parameter]
                (if
                  (contains? declared parameter)
                  []
                  [
                    {
                      :severity :error
                      :code "http/undeclared-path-param"
                      :message (str "Undeclared path parameter " parameter)}]))
              (http/path-parameters endpoint.path))
            (http/type-check endpoint.success)
            (if (nil? endpoint.payload) [] (http/type-check endpoint.payload))
            (flat-map
              (fn [[key t]] (http/type-check t))
              (meta/entries endpoint.query))
            (flat-map
              (fn [[key t]] (http/type-check t))
              (meta/entries endpoint.headers))
            (flat-map
              (fn
                [error]
                (if
                  (= (type/kind error) :error)
                  []
                  [
                    {
                      :severity :error
                      :code "http/undeclared-error"
                      :message
                        (str "HTTP errors require an error declaration: " error)}]))
              endpoint.errors)))
        endpoints))))
(type
  HttpApiIR
  {
    :kind "HttpApi"
    :name Symbol
    :pathParams (Map String Type)
    :endpoints (List HttpEndpointIR)
    :openapi (Option Json)})
(form
  (api name {:keys [path-params openapi]} endpoint ...)
  :types
    {
      :name (Declares HttpApiDecl)
      :path-params (Option (Record Type))
      :openapi (Option Json)
      :endpoint (List http-endpoint)}
  :check
    (fn [{:keys [path-params endpoint]}] (http/api-check path-params endpoint))
  :ir HttpApiIR
  {
    :kind "HttpApi"
    :name name
    :pathParams (or (optional-record path-params) {})
    :endpoints endpoint
    :openapi openapi})
