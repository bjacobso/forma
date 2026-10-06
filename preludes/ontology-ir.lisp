; Generated from ontology.lisp by scripts/derive-domain-protocol.mjs. Do not edit.

; Forms, their IR types and their declaration order are the only source of truth.

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

(type
  MetaEntityIR
  {
    :kind "MetaEntity"
    :name Symbol
    :fields (List EntityFieldIR)
    :doc (Option String)
    :role (Option String)
    :idPattern (Option String)})

(type
  QueryIR
  {
    :kind "Query"
    :name Symbol
    :from Symbol
    :where (Option RuntimeExpr)
    :datalog (Option RuntimeExpr)
    :select (List Keyword)})

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

(type TriggerIR {:kind "Trigger" :triggerKind String :entity Symbol})

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

(type
  ProcessIR
  {
    :kind "Process"
    :name Symbol
    :description (Option String)
    :trigger TriggerIR
    :nodes (List ProcessNodeIR)
    :edges (List ProcessEdgeIR)})

(type DocumentOptionIR {:kind "Option" :value String :label String})

(type
  AttributeBindingIR
  {
    :kind "AttributeBinding"
    :attribute Keyword
    :entity Symbol
    :transform (Option String)
    :cardinality (Option String)})

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

(type
  DocumentCompletionIR
  {
    :kind "CompletionMutation"
    :mutation Symbol
    :mutationRef {:kind "Action" :name Symbol}
    :entity (Option Symbol)
    :entityRef (Option {:kind "Entity" :name Symbol})})

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

(type
  DocumentIR
  {
    :kind "Document"
    :name Symbol
    :description (Option String)
    :pages (List DocumentPageIR)})

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
  DocumentLocaleIR
  {
    :kind "DocumentLocale"
    :documentName Symbol
    :documentRef {:kind "Document" :name Symbol}
    :locale String
    :roles (List DocumentRoleLocaleIR)
    :sections (List DocumentSectionLocaleIR)
    :fields (List DocumentFieldLocaleIR)})

(type
  DocumentLocalizedIR
  {
    :kind "DocumentLocalized"
    :documentName Symbol
    :documentRef {:kind "Document" :name Symbol}
    :locales (List String)
    :defaultLocale (Option String)})

(type PdfSetIR {:kind "Set" :pdfField String :value Json})

(type PdfCaseIR {:kind "Case" :when String :assignments (List PdfSetIR)})

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

(type
  ConstraintTaskAssignmentIR
  {
    :kind "TaskAssignment"
    :role Symbol
    :priority (Option String)
    :title (Option RuntimeExpr)
    :body (Option RuntimeExpr)})

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

(type QueryPresetParamIR {:name String :value RuntimeExpr})

(type
  QueryPresetIR
  {
    :kind "QueryPreset"
    :name Symbol
    :queryRef {:kind "Query" :name Symbol}
    :defaults (List QueryPresetParamIR)
    :mergePolicy String})

(type
  ViewColumnIR
  {:name Keyword :label (Option String) :expr (Option RuntimeExpr)})

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

(type ActionInputIR {:name String :type Type :required Bool})

(type
  ActionIR
  {
    :kind "Action"
    :name Symbol
    :inputs (List ActionInputIR)
    :returns Type
    :do RuntimeExpr})

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

(type
  HttpApiIR
  {
    :kind "HttpApi"
    :name Symbol
    :pathParams (Map String Type)
    :endpoints (List HttpEndpointIR)
    :openapi (Option Json)})

(type CanonicalIR (Union EntityIR MetaEntityIR RelationIR RecordIR LinkIR SystemAttributeIR QueryIR WorkspaceIR IdentityDeclarationIR PermissionDeclarationIR ProcessIR DocumentIR TaskDefinitionIR DocumentLocaleIR DocumentLocalizedIR PdfMappingIR ConstraintIR QueryPresetIR ViewIR ActionIR HttpApiIR))

(type CompiledDeclarations {:entities (List EntityIR)
 :metaEntities (List MetaEntityIR)
 :relations (List RelationIR)
 :records (List RecordIR)
 :links (List LinkIR)
 :systemAttributes (List SystemAttributeIR)
 :queries (List QueryIR)
 :workspaces (List WorkspaceIR)
 :identityDeclarations (List IdentityDeclarationIR)
 :permissionDeclarations (List PermissionDeclarationIR)
 :processes (List ProcessIR)
 :documents (List DocumentIR)
 :taskDefinitions (List TaskDefinitionIR)
 :documentLocales (List DocumentLocaleIR)
 :documentLocalizeds (List DocumentLocalizedIR)
 :pdfMappings (List PdfMappingIR)
 :constraints (List ConstraintIR)
 :queryPresets (List QueryPresetIR)
 :views (List ViewIR)
 :actions (List ActionIR)
 :httpApis (List HttpApiIR)})

(define protocol {:name "OntologyIR"})

(define canonical-ir-declaration-catalog (quote {:extensions {:protocol/catalog {:name "CanonicalIRDeclarations" :entries [{:kind "Entity" :schema "EntityIRSchema" :collection "entities" :flatten-order 1 :index-order 1 :index-name "name" :index-fields ["name"]}
 {:kind "MetaEntity" :schema "MetaEntityIRSchema" :collection "metaEntities" :flatten-order 2 :index-order 2 :index-name "name" :index-fields ["name"]}
 {:kind "Relation" :schema "RelationIRSchema" :collection "relations" :flatten-order 3 :index-order 3 :index-name "name" :index-fields ["name" "source" "target"]}
 {:kind "Record" :schema "RecordIRSchema" :collection "records" :flatten-order 4 :index-order 4 :index-name "name" :index-fields ["name" "id" "entity"]}
 {:kind "Link" :schema "LinkIRSchema" :collection "links" :flatten-order 5 :index-order 5 :index-name "name" :index-fields ["name" "relation" "source" "target" "sourceId" "targetId"]}
 {:kind "SystemAttribute" :schema "SystemAttributeIRSchema" :collection "systemAttributes" :flatten-order 6 :index-order 6 :index-name "name" :index-fields ["name"]}
 {:kind "Query" :schema "QueryIRSchema" :collection "queries" :flatten-order 7 :index-order 7 :index-name "name" :index-fields ["name" "from"]}
 {:kind "Workspace" :schema "WorkspaceIRSchema" :collection "workspaces" :flatten-order 8 :index-order 8 :index-name "name" :index-fields ["name"]}
 {:kind "IdentityDeclaration" :schema "IdentityDeclarationIRSchema" :collection "identityDeclarations" :flatten-order 9 :index-order 9 :index-name "name" :index-fields ["identityKind" "name"]}
 {:kind "PermissionDeclaration" :schema "PermissionDeclarationIRSchema" :collection "permissionDeclarations" :flatten-order 10 :index-order 10 :index-name "name" :index-fields ["name" "principal" "action" "resource" "effect"]}
 {:kind "Process" :schema "ProcessIRSchema" :collection "processes" :flatten-order 11 :index-order 11 :index-name "name" :index-fields ["name"]}
 {:kind "Document" :schema "DocumentIRSchema" :collection "documents" :flatten-order 12 :index-order 12 :index-name "name" :index-fields ["name"]}
 {:kind "TaskDefinition" :schema "TaskDefinitionIRSchema" :collection "taskDefinitions" :flatten-order 13 :index-order 13 :index-name "name" :index-fields ["name" "title"]}
 {:kind "DocumentLocale" :schema "DocumentLocaleIRSchema" :collection "documentLocales" :flatten-order 14 :index-order 14 :index-name "composite" :index-fields ["documentName" "locale"]}
 {:kind "DocumentLocalized" :schema "DocumentLocalizedIRSchema" :collection "documentLocalizeds" :flatten-order 15 :index-order 15 :index-name "composite" :index-fields ["documentName"]}
 {:kind "PdfMapping" :schema "PdfMappingIRSchema" :collection "pdfMappings" :flatten-order 16 :index-order 16 :index-name "name" :index-fields ["name" "templateBlob"]}
 {:kind "Constraint" :schema "ConstraintIRSchema" :collection "constraints" :flatten-order 17 :index-order 17 :index-name "name" :index-fields ["name" "entity" "severity"]}
 {:kind "QueryPreset" :schema "QueryPresetIRSchema" :collection "queryPresets" :flatten-order 18 :index-order 18 :index-name "name" :index-fields ["name" "mergePolicy"]}
 {:kind "View" :schema "ViewIRSchema" :collection "views" :flatten-order 19 :index-order 19 :index-name "name" :index-fields ["name"]}
 {:kind "Action" :schema "ActionIRSchema" :collection "actions" :flatten-order 20 :index-order 20 :index-name "name" :index-fields ["name"]}
 {:kind "HttpApi" :schema "HttpApiIRSchema" :collection "httpApis" :flatten-order 21 :index-order 21 :index-name "name" :index-fields ["name"]}]}}}))
