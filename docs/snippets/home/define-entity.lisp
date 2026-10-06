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
