; action-protocol.lisp
; -----------------------------------------------------------------------------
; Hosted ActionPlan protocol descriptors.
; -----------------------------------------------------------------------------

(type PrimitiveActionFieldType
  {:kind "primitive"
   :type ActionPrimitiveType})

(type ActionRefType
  {:kind "ref"
   :type TypeRef})

(type ActionRefsType
  {:kind "refs"
   :type TypeRef})

(type ActionEnumType
  {:kind "enum"
   :values (List String)})

(type ActionFieldType
  (Union PrimitiveActionFieldType ActionRefType ActionRefsType ActionEnumType))

(type ActionFieldValidation
  {:min (Option Number)
   :max (Option Number)
   :pattern (Option String)
   :format (Option String)})

(type ActionInput
  {:name String
   :type ActionFieldType
   :required (Option Bool)
   :description (Option String)
   :validation (Option ActionFieldValidation)})

(type ActionSetClause
  {:attr String
   :value QueryValueExpr})

(type CreateActionEffect
  {:kind "create"
   :type TypeRef
   :sets (List ActionSetClause)})

(type PatchActionEffect
  {:kind "patch"
   :target QueryValueExpr
   :sets (List ActionSetClause)})

(type LinkActionEffect
  {:kind "link"
   :from QueryValueExpr
   :type RelationshipTypeRef
   :to QueryValueExpr
   :properties (Option (List ActionSetClause))})

(type EmitActionEffect
  {:kind "emit"
   :event String
   :payload (Option QueryValueExpr)})

(type ReturnActionEffect
  {:kind "return"
   :value QueryValueExpr})

(type ActionEffect
  (Union CreateActionEffect PatchActionEffect LinkActionEffect EmitActionEffect ReturnActionEffect))

(type ActionRequiresPermission
  {:permission String
   :on (Option QueryValueExpr)})

(type ActionAuth
  {:requires (List ActionRequiresPermission)})

(type ActionPlan
  {:v 1
   :name String
   :description (Option String)
   :inputs (List ActionInput)
   :auth (Option ActionAuth)
   :effects (List ActionEffect)})

(type ActionPrimitiveType (Union "String" "Number" "Boolean" "Datetime" "Json"))

(define protocol {:name "ActionPlan" :imports [["RelationshipTypeRef" "from" "QueryPlan" "RelationshipTypeRef"] ["TypeRef" "from" "QueryPlan" "TypeRef"] ["QueryValueExpr" "from" "QueryPlan" "QueryValueExpr"]]})
