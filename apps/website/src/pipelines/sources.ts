// Sources shared by the playground pipelines and the generated docs homepage
// snippets. `sources.test.ts` keeps the copies of repository files in sync.

/** Verbatim copy of `conformance/fixtures/canonical-ir/schema.lisp`. */
export const entitySchemaSource = `(define-entity Department
  (:field [department/name String {:required true}]))

(define-entity Employee
  (:field [employee/name String {:required true}])
  (:field [employee/department (Ref Department)])
  (:field [employee/active Bool]))

(define-query employee-directory
  (:from Employee)
  (:where employee/active)
  (:select [employee/name employee/department]))
`;

/** Verbatim excerpt of `preludes/ontology.lisp`. */
export const defineEntityDescriptor = `(define-form define-entity
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
  (:result-type (constant SchemaDecl)))`;

const consoleServiceSource = `(define-error ConsoleUnavailable
  (:fields (field message String)))

(define-service Console
  (:methods
    (print [message String]
      (Effect Unit [ConsoleUnavailable] []))))
`;

const logOperationSource = `(define-operation log [message]
  (do! [_ (Console.print message)]
    (succeed nil)))`;

export const contractSource = `${consoleServiceSource}
(: log (-> String (Effect Unit [ConsoleUnavailable] [Console.print])))
${logOperationSource}`;

export const undeclaredCapabilitySource = `${consoleServiceSource}
(: log (-> String (Effect Unit [ConsoleUnavailable] [])))
${logOperationSource}`;

export const undeclaredFailureSource = `${consoleServiceSource}
(: log (-> String (Effect Unit [] [Console.print])))
${logOperationSource}`;

/** The type the TypeScript engine infers for `contractSource`. */
export const contractType =
  "String -> Effect<Unit, ErrorSet<ConsoleUnavailable>, RequirementSet<Console.print>>";
