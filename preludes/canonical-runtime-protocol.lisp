; canonical-runtime-protocol.lisp
; -----------------------------------------------------------------------------
; Hosted CanonicalRuntime protocol descriptors.
; -----------------------------------------------------------------------------

(type Span
  {:sourceId String
   :startOffset Number
   :endOffset Number})

(type CanonicalExpr (Union Unit Bool Number String (List CanonicalExpr) (Map String CanonicalExpr)))

(type CanonicalRuntimeExpr
  {:kind "raw-expr"
   :expr CanonicalExpr})

(type CanonicalRuntimeActionInput
  {:name String
   :entityRef CanonicalDeclarationRef})

(type CanonicalRuntimeFieldValue
  {:field String
   :value CanonicalExpr})

(type CanonicalRuntimeEmitStep
  {:kind "emit"
   :event CanonicalExpr})

(type CanonicalRuntimeSetFieldStep
  {:kind "set-field"
   :targetBinding String
   :field String
   :value CanonicalExpr})

(type CanonicalRuntimeCreateEntityStep
  {:kind "create-entity"
   :entityName String
   :assignments (List CanonicalRuntimeFieldValue)})

(type CanonicalRuntimeLinkRecordsStep
  {:kind "link-records"
   :sourceBinding String
   :targetBinding String
   :relation String})

(type CanonicalRuntimeCallActionStep
  {:kind "call-action"
   :actionRef CanonicalDeclarationRef
   :entityArguments (List String)
   :arguments (List CanonicalRuntimeFieldValue)})

(type CanonicalRuntimeEvalStep
  {:kind "eval"
   :expr CanonicalRuntimeExpr})

(type CanonicalRuntimeActionStep
  (Union CanonicalRuntimeEmitStep CanonicalRuntimeSetFieldStep CanonicalRuntimeCreateEntityStep CanonicalRuntimeLinkRecordsStep CanonicalRuntimeCallActionStep CanonicalRuntimeEvalStep))

(type CanonicalRuntimeAction
  {:kind "RuntimeAction"
   :name String
   :inputs (List CanonicalRuntimeActionInput)
   :declaredReturnType CanonicalExpr
   :steps (List CanonicalRuntimeActionStep)
   :loc (Option Span)})

(define protocol {:name "CanonicalRuntime" :imports [["CanonicalDeclarationRef" "from" "CanonicalRef" "CanonicalDeclarationRef"]]})
