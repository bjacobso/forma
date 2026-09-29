(define-form define-entity
  (:phase domain)
  (:doc "Canonical entity/schema declaration.")
  (:identifiers
    (identifier name Symbol (:declaration true)))
  (:slots
    (slot doc value)
    (slot role value)
    (slot id-pattern value)
    (slot field value
      (:many true)
      (:required true)
      (:child-form field)
      (:child-identifier name Value)
      (:child-slot type expr (:positional true))
      (:child-slot required value)
      (:child-slot indexed value)))
  (:bindings
    (bind bind-declaration-name (:identifier name) (:type SchemaDecl)))
  (:bindings-fn entity/bindings)
  (:extensions
    (:artifact
      (:payload (:contract EntityPayload))))
  (:construct-fn entity/construct)
  (:construct
    [kind "Entity"]
    [name (or declaration-name "anonymous-entity")]
    [fields (entity-fields field)]
    [loc loc])
  (:declaration-type (row))
  (:result-type (constant SchemaDecl)))
