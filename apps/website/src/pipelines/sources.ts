// Sources shared by the playground pipelines and the generated docs homepage
// snippets. `sources.test.ts` keeps the copies of repository files in sync.

/** Verbatim copy of `conformance/fixtures/canonical-ir/schema.lisp`. */
export const entitySchemaSource = `(entity Department {:name String})

(entity Employee {:name String
    :department (Option (Id Department))
    :active Bool})

(query employee-directory
  :from Employee
  :where active
  :select [name department])
`;

/** Verbatim excerpt of `preludes/ontology.lisp`. */
export const defineEntityDescriptor = `(form
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
    :idPattern id-pattern})`;

const consoleServiceSource = `(error ConsoleUnavailable {:message String})

(service Console
  (: print (-> String (Effect Unit [ConsoleUnavailable] []))))
`;

const logOperationSource = `(define log [message]
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

/** A prelude that declares tool names, for the homepage's composition example. */
export const composeToolsSource = `(export tool ToolDecl)

(type ToolDecl Symbol)
(type ToolIR {:kind "Tool" :name Symbol :doc String})

(form (tool name doc)
  "Declare a tool an agent may call."
  :types {:name (Declares ToolDecl) :doc String}
  :ir ToolIR
  {:kind "Tool" :name name :doc doc})
`;

/** A second prelude whose form refers to names the first one declares. */
export const composeAgentsSource = `(import "./tools.forma" [ToolDecl])
(export allow)

(type AllowDecl Symbol)
(type AllowIR {:kind "Allow" :name Symbol :tool Symbol})

(form (allow name tool)
  "Let an agent call one declared tool."
  :types {:name (Declares AllowDecl) :tool (Refers ToolDecl)}
  :ir AllowIR
  {:kind "Allow" :name name :tool tool})
`;

/** A program written in both vocabularies. */
export const composeSupportSource = `(import "./tools.forma" [tool])
(import "./agents.forma" [allow])

(tool refund "Refund an order.")
(allow support-refunds refund)
`;

/** The same program with a reference to a tool that no prelude declares. */
export const composeSupportBrokenSource = `${composeSupportSource}(allow support-deletes delete-account)
`;
