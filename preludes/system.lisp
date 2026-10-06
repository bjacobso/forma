; system.lisp
; -----------------------------------------------------------------------------
; Unified platform self-description.
;
; This file is the canonical intrinsic catalog for cross-cutting system
; attributes, bootstrap schema entities, platform metadata entities, and
; runtime-owned record types.
; -----------------------------------------------------------------------------
; =============================================================================
; SECTION 1 — SYSTEM ATTRIBUTES
; =============================================================================
(attribute _schema/type String
  :doc "Entity type discriminant for platform-owned entities.")
(attribute _schema/created-at (Option Number)
  :doc "Creation timestamp in epoch milliseconds.")
(attribute _schema/updated-at (Option Number)
  :doc "Last update timestamp in epoch milliseconds.")
(attribute _schema/created-by (Option String)
  :doc "Actor or principal responsible for creation.")
(attribute _schema/version (Option Number)
  :doc "Version marker for versioned system definitions.")
(attribute _schema/enabled (Option Bool)
  :doc "Soft-delete / enablement flag for platform-owned entities.")
(attribute _meta/role
  (Union "schema-definition" "system-metadata" "runtime-record")
  :doc "Architectural role of a platform-owned entity.")

; =============================================================================
; SECTION 2 — META-SCHEMA
; =============================================================================
(entity EntityType
  {
    :_type/name (String :indexed true)
    :_type/version (Number :indexed true)
    :_type/description (Option String)
    :_type/plural (Option String)}
  :tier :meta
  :doc "Decomposed entity type definition stored as first-class triples."
  :role "schema-definition"
  :id-pattern "_schema/entity-type/{name}/v{version}")
(entity AttributeDefinition
  {
    :_attr/name String
    :_attr/value-type String
    :_attr/required (Option Bool)
    :_attr/indexed (Option Bool)
    :_attr/unique (Option Bool)
    :_attr/default (Option String)
    :_attr/description (Option String)
    :_attr/belongs-to (String :indexed true)
    :_attr/validation-min (Option Number)
    :_attr/validation-max (Option Number)
    :_attr/validation-pattern (Option String)
    :_attr/validation-format (Option String)
    :_attr/validation-enum (Option Json)
    :_attr/validation-message (Option String)}
  :tier :meta
  :doc "Attribute definition belonging to an EntityType."
  :role "schema-definition"
  :id-pattern "{parent}/attr/{name}")
(entity RelationshipDefinition
  {
    :_rel/name String
    :_rel/target-type String
    :_rel/cardinality (Option String)
    :_rel/required (Option Bool)
    :_rel/description (Option String)
    :_rel/inverse (Option String)
    :_rel/belongs-to (String :indexed true)}
  :tier :meta
  :doc "Relationship definition belonging to an EntityType."
  :role "schema-definition"
  :id-pattern "{parent}/rel/{name}")

; =============================================================================
; SECTION 3 — SCHEMA / SYSTEM METADATA ENTITY TYPES
; =============================================================================
(entity AttributeType
  {
    :_meta/attribute-name (String :indexed true)
    :_meta/display-name (Option String)
    :_meta/value-type String
    :_meta/category String
    :_meta/description (Option String)
    :_meta/validation (Option Json)
    :_meta/deprecated (Option Bool)
    :_meta/deprecated-at (Option Number)}
  :doc "Registry entry describing a known attribute name and its metadata."
  :role "schema-definition"
  :id-pattern "_meta/attribute:{attributeName}")
(entity RelationshipType
  {
    :_schema/relationship-type-name (String :indexed true)
    :_meta/version (Number :indexed true)
    :_meta/source-type String
    :_meta/target-type String
    :_meta/definition Json}
  :doc "Versioned relationship type definition stored by the runtime registry."
  :role "schema-definition"
  :id-pattern "_schema/relationship-type/{name}/v{version}")
(entity SavedQuery
  {
    :_schema/query-name (String :indexed true)
    :_meta/version (Number :indexed true)
    :_meta/display-name String
    :_meta/definition Json
    :_meta/tags (Option Json)}
  :doc "Versioned saved Datalog query definition."
  :role "system-metadata"
  :id-pattern "_schema/query/{name}/v{version}")
(entity View {:view/name (String :indexed true) :view/definition Json}
  :doc "Persisted declarative UI view definition."
  :role "system-metadata"
  :id-pattern "_schema/view/{name}")
(entity Workspace
  {:workspace/name (String :indexed true) :workspace/definition Json}
  :doc "Named operational workspace definition."
  :role "system-metadata"
  :id-pattern "_schema/workspace/{name}")
(entity Constraint
  {
    :_schema/constraint-name (String :indexed true)
    :_meta/entity-type (String :indexed true)
    :_meta/severity (String :indexed true)
    :_meta/category (Option String)
    :_schema/constraint Json}
  :doc "Stored constraint definition plus queryable selectors."
  :role "system-metadata"
  :id-pattern "_schema/constraint/{ulid}")
(entity ActionDefinition
  {
    :action/name (String :indexed true)
    :action/object-type (String :indexed true)
    :action/version (Number :indexed true)
    :action/definition Json}
  :doc "Versioned action definition available to processes and UI."
  :role "system-metadata"
  :id-pattern "_action/{entityType}/{name}/v{version}")
(entity DocumentDefinition
  {
    :document-definition:name (String :indexed true)
    :document-definition:definition Json
    :document-definition:translations (Option Json)
    :document-definition:source-ir (Option Json)}
  :doc "Structured document template definition."
  :role "system-metadata"
  :id-pattern "document-definition:{ulid}")
(entity Process
  {
    :name (String :indexed true)
    :version (Number :indexed true)
    :definition Json}
  :doc "Versioned workflow/process definition."
  :role "system-metadata"
  :id-pattern "_process/{name}/v{version}")
(entity TaskDefinition
  {
    :name (String :indexed true)
    :title String
    :description (Option String)
    :document-ref (Option String)
    :section-refs (Option Json)
    :default-assignee (Option Json)
    :guidance-ref (Option String)
    :inputs (Option Json)
    :scope (Option Json)
    :version (Number :indexed true)}
  :doc "Reusable ontology-authored task definition."
  :role "system-metadata"
  :id-pattern "_task-definition/{name}/v{version}")
(entity PdfMapping {:name (String :indexed true) :definition Json}
  :doc "Named PDF field-mapping definition."
  :role "system-metadata"
  :id-pattern "pdf-mapping:{name}")

; =============================================================================
; SECTION 4 — RUNTIME RECORDS
; =============================================================================
(entity Task
  {
    :title String
    :description (Option String)
    :type String
    :status String
    :priority String
    :due-date (Option Number)
    :reminder-date (Option Number)
    :tags (Option Json)
    :metadata (Option Json)
    :version (Option Number)
    :created-at (Option Number)
    :created-by (Option String)
    :updated-at (Option Number)
    :completed-at (Option Number)
    :completed-by (Option String)
    :resolution (Option String)
    :assigned-to (Option String)
    :assigned-role (Option String)
    :assigned-team (Option String)
    :assigned-at (Option Number)
    :assigned-by (Option String)
    :entity-id (Option String)
    :entity-type (Option String)
    :violation-id (Option String)
    :constraint-id (Option String)
    :parent-task-id (Option String)
    :related-task-ids (Option Json)
    :completion-type (Option String)
    :completion-document-ref (Option String)
    :completion-document-instance-ref (Option String)
    :completion-section-refs (Option Json)
    :completion-outcomes (Option Json)
    :completion-view-spec (Option Json)}
  :role "runtime-record"
  :id-pattern "_task/{ulid}")
(entity EffectExecution
  {
    :effect-kind (String :indexed true)
    :owner-kind (String :indexed true)
    :owner-id (String :indexed true)
    :status (String :indexed true)
    :input (Option Json)
    :output (Option Json)
    :error (Option Json)
    :started-at (Number :indexed true)
    :completed-at (Option Number :indexed true)}
  :doc "Audit receipt for a host-executed runtime effect."
  :role "runtime-record"
  :id-pattern "_effect-execution/{ulid}")
(entity Violation
  {
    :constraint-id String
    :constraint-name String
    :entity-id String
    :entity-type String
    :severity String
    :message String
    :status String
    :detected-at Number
    :status-changed-at (Option Number)
    :status-changed-by (Option String)
    :notes (Option String)
    :resolution-action-id (Option String)
    :task-id (Option String)
    :bindings (Option Json)}
  :role "runtime-record"
  :id-pattern "_violation/{ulid}")
(entity DocumentInstance
  {
    :document-id String
    :entity-id String
    :entity-type String
    :status String
    :due-date (Option Number)
    :completed-at (Option Number)
    :completed-sections (Option Json)
    :data (Option Json)
    :context (Option Json)
    :assignments (Option Json)
    :created-at Number}
  :role "runtime-record"
  :id-pattern "document-instance:{ulid}")
(entity SectionSubmission
  {
    :document-section-submission/instance-id String
    :document-section-submission/section-id String
    :document-section-submission/submitted-by String
    :document-section-submission/submitted-at Number
    :document-section-submission/data Json
    :document-section-submission/signature (Option String)}
  :role "runtime-record"
  :id-pattern "document-submission:{ulid}")
(entity PendingSection
  {
    :instance-id String
    :section-id String
    :section-title String
    :document-name String
    :document-id String
    :entity-id String
    :entity-type String
    :assigned-entity-id (Option String)
    :assigned-entity-type (Option String)
    :role (Option String)
    :due-date (Option Number)
    :is-blocked Bool
    :blocked-by (Option String)
    :status String}
  :role "runtime-record"
  :id-pattern "pending-section:{instanceId}:{sectionId}")
(entity ActionExecution
  {
    :exec/action-id String
    :exec/action-name String
    :exec/action-version Number
    :exec/entity-type String
    :exec/target-entity String
    :exec/parameters Json
    :exec/status String
    :exec/task-id (Option String)
    :exec/result (Option Json)
    :exec/created-by (Option String)
    :exec/created-at (Option Number)
    :exec/completed-at (Option Number)
    :exec/completed-by (Option String)
    :exec/rejection-reason (Option String)}
  :role "runtime-record"
  :id-pattern "_action-exec:{ulid}")
(entity ProcessRun
  {
    :process-instance/definition-id String
    :process-instance/status String
    :process-instance/triggered-at Number
    :process-instance/triggered-by String
    :process-instance/entity-id (Option String)
    :process-instance/entity-type (Option String)
    :process-instance/context (Option Json)
    :process-instance/completed-at (Option Number)
    :process-instance/error (Option String)}
  :role "runtime-record"
  :id-pattern "_process-inst:{ulid}")
(entity NodeExecution
  {
    :node-exec/instance-id String
    :node-exec/node-id String
    :node-exec/status String
    :node-exec/started-at (Option Number)
    :node-exec/completed-at (Option Number)
    :node-exec/output (Option Json)
    :node-exec/error (Option String)
    :node-exec/wake-at (Option Number)
    :node-exec/task-ref (Option String)}
  :role "runtime-record"
  :id-pattern "_node-exec:{instanceId}:{nodeId}")
(entity IntegrationResult
  {
    :integration/document-instance-id (String :indexed true)
    :integration/section-id (String :indexed true)
    :integration/adapter-type String
    :integration/status (String :indexed true)
    :integration/request-id (Option String)
    :integration/result (Option Json)
    :integration/error (Option String)
    :integration/definition Json}
  :role "runtime-record"
  :id-pattern "integration:{ulid}")
(entity Notification
  {:handler String :status String :entity (Option String) :input (Option Json)}
  :role "runtime-record"
  :id-pattern "_notif:{ulid}")
(entity PdfFillResult
  {
    :pdf-fill/mapping-name String
    :pdf-fill/document-submission-id (Option String)
    :pdf-fill/entity-id (Option String)
    :pdf-fill/output-blob-hash String
    :pdf-fill/output-filename String
    :pdf-fill/filled-at Number
    :pdf-fill/unmapped-fields (Option Json)}
  :role "runtime-record"
  :id-pattern "pdf-fill/{ulid}")
