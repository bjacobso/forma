import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { packageDir, readPreludes } from "./corpus.mjs";
import { requireNativeCli } from "./require-build.mjs";

const nativeCli = requireNativeCli();

const daemon = spawn(nativeCli, ["daemon"], {
  cwd: packageDir,
  stdio: ["pipe", "pipe", "pipe"],
});

const daemonExit = new Promise((resolveExit) => daemon.on("close", resolveExit));

let stderr = "";
daemon.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const responses = [];
const waiters = [];
const lines = createInterface({ input: daemon.stdout });

lines.on("line", (line) => {
  responses.push(line);
  const waiter = waiters.shift();
  if (waiter) waiter();
});

const waitForLine = async () => {
  if (responses.length > 0) return responses.shift();
  return new Promise((resolveLine, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for daemon response. stderr: ${stderr}`));
    }, 5000);
    waiters.push(() => {
      clearTimeout(timeout);
      resolveLine(responses.shift());
    });
  });
};

const request = async (payload) => {
  daemon.stdin.write(`${JSON.stringify(payload)}\n`);
  const line = await waitForLine();
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`Could not parse daemon response ${JSON.stringify(line)}: ${error}`);
  }
};

const expectOk = (label, response) => {
  if (response?.ok !== true) {
    throw new Error(`${label} failed:\n${JSON.stringify(response, null, 2)}`);
  }
};

const expectMalformedDiagnostic = ({
  label,
  response,
  code,
  sourceId,
  source,
  form,
  messageIncludes,
}) => {
  const diagnostic = response?.diagnostics?.[0];
  if (
    response?.ok !== false ||
    diagnostic?.code !== code ||
    diagnostic?.span == null ||
    diagnostic.span.sourceId !== sourceId ||
    diagnostic.span.startOffset !== source.indexOf(form) ||
    messageIncludes.some((snippet) => !diagnostic.message?.includes(snippet))
  ) {
    throw new Error(`Expected ${label} diagnostic:\n${JSON.stringify(response, null, 2)}`);
  }
};

const preludes = readPreludes();

const schemaSourceId = "emit/schema";
const dataSourceId = "emit/data";
const schemaSource = `
(entity Department {:name String})

(entity Employee {:name String
    :department (Option (Id Department))
    :active (Option Bool)})

(query employee-directory
  :from Employee
  :where (= active (Some true))
  :select [name department])
`;

const dataSource = `
(seed Department "department:platform" {:name "Platform"})

(seed Employee "employee:ada" {:name "Ada Lovelace"
  :department "department:platform"})
`;

const peopleModuleSourceId = "people.md";
const hiringModuleSourceId = "hiring.md";
const peopleModuleSource = `
(export Person)

(entity Person {:name (Option String)})
`;

const hiringModuleSource = `
(use ontology.alpha)
(import "./people.md" :as people)
(export Candidate)

(entity Candidate {:name (Option String)})
`;

const invalidIrSourceId = "emit/invalid-ir";
const invalidIrSource = `
(__form-descriptor define-invalid-ir
  (:identifier name)
  (:construct-fn invalid-ir/construct))

(__form-hook invalid-ir/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output InvalidIr)
  (:body
    (construct/object
      :kind "Invalid"
      :name (meta/declaration-name input)
      :$summary (construct/summary
        :kind "Invalid"
        :name (meta/declaration-name input)
        :resultType "InvalidIr")
      :leak (fn [] 1))))

(define-invalid-ir bad)
`;

const invalidSummarySourceId = "emit/invalid-summary";
const invalidSummarySource = `
(__form-descriptor define-invalid-summary
  (:identifier name)
  (:construct-fn invalid-summary/construct)
  (:result-type (constant List)))

(__form-hook invalid-summary/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output InvalidSummary)
  (:body
    (construct/declaration
      :kind "InvalidSummary"
      :name (meta/declaration-name input)
      :$summary (construct/object :name (meta/declaration-name input)))))

(define-invalid-summary bad-summary)
`;

const invalidSummaryNameSourceId = "emit/invalid-summary-name";
const invalidSummaryNameSource = `
(__form-descriptor define-invalid-summary-name
  (:identifier name)
  (:construct-fn invalid-summary-name/construct)
  (:result-type (constant List)))

(__form-hook invalid-summary-name/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output InvalidSummaryName)
  (:body
    (construct/declaration
      :kind "InvalidSummaryName"
      :name (meta/declaration-name input)
      :$summary (construct/object :kind "InvalidSummaryName" :name 42))))

(define-invalid-summary-name bad-summary-name)
`;

const invalidSummaryResultTypeSourceId = "emit/invalid-summary-result-type";
const invalidSummaryResultTypeSource = `
(__form-descriptor define-invalid-summary-result-type
  (:identifier name)
  (:construct-fn invalid-summary-result-type/construct)
  (:result-type (constant List)))

(__form-hook invalid-summary-result-type/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output InvalidSummaryResultType)
  (:body
    (construct/declaration
      :kind "InvalidSummaryResultType"
      :name (meta/declaration-name input)
      :$summary (construct/object
        :kind "InvalidSummaryResultType"
        :name (meta/declaration-name input)))))

(define-invalid-summary-result-type bad-summary-result-type)
`;

const invalidMaskedSummarySourceId = "emit/invalid-masked-summary";
const invalidMaskedSummarySource = `
(__form-descriptor define-invalid-masked-summary
  (:identifier name)
  (:construct-fn invalid-masked-summary/construct)
  (:result-type (constant MaskedSummaryDef)))

(__form-hook invalid-masked-summary/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output InvalidMaskedSummary)
  (:body
    (construct/declaration
      :kind "MaskedSummary"
      :name (meta/declaration-name input)
      :$summary (construct/object :name (meta/declaration-name input)))))

(define-invalid-masked-summary bad-masked-summary)
`;

const implicitSummarySourceId = "emit/implicit-summary";
const implicitSummarySource = `
(__form-descriptor define-implicit-summary
  (:identifier name)
  (:construct-fn implicit-summary/construct)
  (:result-type (constant ImplicitSummaryDef)))

(__form-hook implicit-summary/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output ImplicitSummary)
  (:body
    (construct/object
      :kind "ImplicitSummary"
      :name (meta/declaration-name input))))

(define-implicit-summary inferred)
`;

const mismatchedSummarySourceId = "emit/mismatched-summary";
const mismatchedSummarySource = `
(__form-descriptor define-mismatched-summary
  (:identifier name)
  (:construct-fn mismatched-summary/construct)
  (:result-type (constant MismatchedSummaryDef)))

(__form-hook mismatched-summary/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output MismatchedSummary)
  (:body
    (construct/declaration
      :kind "ActualSummaryKind"
      :name (meta/declaration-name input)
      :$summary (construct/summary
        :kind "WrongSummaryKind"
        :name (meta/declaration-name input)
        :resultType "MismatchedSummaryDef"))))

(define-mismatched-summary bad-summary-mismatch)
`;

const mismatchedDescriptorKindSourceId = "emit/mismatched-descriptor-kind";
const mismatchedDescriptorKindSource = `
(__form-descriptor define-mismatched-descriptor-kind
  (:identifier name)
  (:construct-fn mismatched-descriptor-kind/construct)
  (:construct [kind "DescriptorSummaryKind"])
  (:result-type (constant DescriptorSummaryDef)))

(__form-hook mismatched-descriptor-kind/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output DescriptorSummaryDef)
  (:body
    (construct/declaration
      :kind "WrongDescriptorSummaryKind"
      :name (meta/declaration-name input)
      :$summary (construct/summary
        :kind "WrongDescriptorSummaryKind"
        :name (meta/declaration-name input)
        :resultType "DescriptorSummaryDef"))))

(define-mismatched-descriptor-kind bad-descriptor-kind-mismatch)
`;

const mismatchedDescriptorNameSourceId = "emit/mismatched-descriptor-name";
const mismatchedDescriptorNameSource = `
(__form-descriptor define-mismatched-descriptor-name
  (:identifier name)
  (:construct-fn mismatched-descriptor-name/construct)
  (:construct
    [kind "DescriptorName"]
    [name declaration-name])
  (:result-type (constant DescriptorNameDef)))

(__form-hook mismatched-descriptor-name/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output DescriptorNameDef)
  (:body
    (construct/declaration
      :kind "DescriptorName"
      :name "wrong-descriptor-name"
      :$summary (construct/summary
        :kind "DescriptorName"
        :name "wrong-descriptor-name"
        :resultType "DescriptorNameDef"))))

(define-mismatched-descriptor-name bad-descriptor-name-mismatch)
`;

const mismatchedSummaryResultTypeSourceId = "emit/mismatched-summary-result-type";
const mismatchedSummaryResultTypeSource = `
(__form-descriptor define-mismatched-summary-result-type
  (:identifier name)
  (:construct-fn mismatched-summary-result-type/construct)
  (:result-type (constant ActualSummaryResultDef)))

(__form-hook mismatched-summary-result-type/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output ActualSummaryResultDef)
  (:body
    (construct/declaration
      :kind "ActualSummaryResult"
      :name (meta/declaration-name input)
      :$summary (construct/summary
        :kind "ActualSummaryResult"
        :name (meta/declaration-name input)
        :resultType "WrongSummaryResultDef"))))

(define-mismatched-summary-result-type bad-summary-result-mismatch)
`;

const payloadResultTypeSourceId = "emit/payload-result-type";
const payloadResultTypeSource = `
(__form-descriptor define-payload-result-type
  (:identifier name)
  (:construct-fn payload-result-type/construct)
  (:result-type (constant SummaryOnlyDef)))

(__form-hook payload-result-type/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output SummaryOnlyDef)
  (:body
    (construct/declaration
      :kind "PayloadResultType"
      :name (meta/declaration-name input)
      :resultType "PayloadShouldNotDriveSummary"
      :$summary (construct/summary
        :kind "PayloadResultType"
        :name (meta/declaration-name input)
        :resultType "SummaryOnlyDef"))))

(define-payload-result-type payload-result-type)
`;

const unknownValidatorSourceId = "emit/unknown-validator";
const unknownValidatorSource = `
(__form-descriptor define-unknown-validator
  (:identifier name)
  (:extensions
    (:artifact
      (:validators [missing-validator])))
  (:construct-fn unknown-validator/construct)
  (:result-type (constant UnknownValidatorDef)))

(__form-hook unknown-validator/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output UnknownValidatorDef)
  (:body
    (construct/declaration
      :kind "UnknownValidator"
      :name (meta/declaration-name input)
      :$summary (construct/summary
        :kind "UnknownValidator"
        :name (meta/declaration-name input)
        :resultType "UnknownValidatorDef"))))

(define-unknown-validator unknown-validator)
`;

const malformedValidatorSourceId = "emit/malformed-validator";
const malformedValidatorSource = `
(__form-descriptor define-malformed-validator
  (:identifier name)
  (:extensions
    (:artifact
      (:validators [http 42])))
  (:construct-fn malformed-validator/construct)
  (:result-type (constant MalformedValidatorDef)))

(__form-hook malformed-validator/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output MalformedValidatorDef)
  (:body
    (construct/declaration
      :kind "MalformedValidator"
      :name (meta/declaration-name input)
      :$summary (construct/summary
        :kind "MalformedValidator"
        :name (meta/declaration-name input)
        :resultType "MalformedValidatorDef"))))

(define-malformed-validator malformed-validator)
`;

const duplicateValidatorSourceId = "emit/duplicate-validator";
const duplicateValidatorSource = `
(__form-descriptor define-duplicate-validator
  (:identifier name)
  (:extensions
    (:artifact
      (:validators [http http])))
  (:construct-fn duplicate-validator/construct)
  (:result-type (constant DuplicateValidatorDef)))

(__form-hook duplicate-validator/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output DuplicateValidatorDef)
  (:body
    (construct/declaration
      :kind "DuplicateValidator"
      :name (meta/declaration-name input)
      :$summary (construct/summary
        :kind "DuplicateValidator"
        :name (meta/declaration-name input)
        :resultType "DuplicateValidatorDef"))))

(define-duplicate-validator duplicate-validator)
`;

const malformedPayloadContractSourceId = "emit/malformed-payload-contract";
const malformedPayloadContractSource = `
(__form-descriptor define-malformed-payload-contract
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:required-fields [kind 42]))))
  (:construct-fn malformed-payload-contract/construct)
  (:result-type (constant MalformedPayloadContractDef)))

(__form-hook malformed-payload-contract/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output MalformedPayloadContractDef)
  (:body
    (construct/declaration
      :kind "MalformedPayloadContract"
      :name (meta/declaration-name input)
      :$summary (construct/summary
        :kind "MalformedPayloadContract"
        :name (meta/declaration-name input)
        :resultType "MalformedPayloadContractDef"))))

(define-malformed-payload-contract malformed-payload-contract)
`;

const missingPayloadFieldSourceId = "emit/missing-payload-field";
const missingPayloadFieldSource = `
(__form-descriptor define-missing-payload-field
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:required-fields [kind name externalId]))))
  (:construct-fn missing-payload-field/construct)
  (:result-type (constant MissingPayloadFieldDef)))

(__form-hook missing-payload-field/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output MissingPayloadFieldDef)
  (:body
    (construct/declaration
      :kind "MissingPayloadField"
      :name (meta/declaration-name input)
      :$summary (construct/summary
        :kind "MissingPayloadField"
        :name (meta/declaration-name input)
        :resultType "MissingPayloadFieldDef"))))

(define-missing-payload-field missing-payload-field)
`;

const objectPayloadFieldSourceId = "emit/object-payload-field";
const objectPayloadFieldSource = `
(__form-descriptor define-object-payload-field
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:required-fields [kind name metadata]))))
  (:construct-fn object-payload-field/construct)
  (:result-type (constant ObjectPayloadFieldDef)))

(__form-hook object-payload-field/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output ObjectPayloadFieldDef)
  (:body
    (construct/declaration
      :kind "ObjectPayloadField"
      :name (meta/declaration-name input)
      :metadata (construct/object :source "descriptor")
      :$summary (construct/summary
        :kind "ObjectPayloadField"
        :name (meta/declaration-name input)
        :resultType "ObjectPayloadFieldDef"))))

(define-object-payload-field object-payload-field)
`;

const typedPayloadFieldSourceId = "emit/typed-payload-field";
const typedPayloadFieldSource = `
(__form-descriptor define-typed-payload-field
  (:identifier name)
  (:extensions
    (:artifact
      (:payload
        (:required-fields [kind name metadata tags])
        (:literal-fields [[kind "TypedPayloadField"]])
        (:string-fields [kind name])
        (:object-fields [metadata])
        (:array-fields [tags]))))
  (:construct-fn typed-payload-field/construct)
  (:result-type (constant TypedPayloadFieldDef)))

(__form-hook typed-payload-field/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output TypedPayloadFieldDef)
  (:body
    (construct/declaration
      :kind "TypedPayloadField"
      :name (meta/declaration-name input)
      :metadata (construct/object :source "descriptor")
      :tags ["contract"]
      :$summary (construct/summary
        :kind "TypedPayloadField"
        :name (meta/declaration-name input)
        :resultType "TypedPayloadFieldDef"))))

(define-typed-payload-field typed-payload-field)
`;

const malformedQueryPayloadSourceId = "emit/malformed-query-payload";
const malformedQueryPayloadSource = `
(__form-descriptor define-malformed-query-payload
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:required-fields [kind]) (:string-fields [kind]))))
  (:construct-fn malformed-query-payload/construct)
  (:result-type (constant List)))

(__form-hook malformed-query-payload/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output QueryDef)
  (:body
    (construct/declaration
      :kind "Query"
      :name (meta/declaration-name input)
      :from 42
      :select ["employee/name"]
      :$summary (construct/summary
        :kind "Query"
        :name (meta/declaration-name input)
        :resultType "List"))))

(define-malformed-query-payload malformed-query-payload)
`;

const malformedRecordPayloadSourceId = "emit/malformed-record-payload";
const malformedRecordPayloadSource = `
(__form-descriptor define-malformed-record-payload
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:required-fields [kind]) (:string-fields [kind]))))
  (:construct-fn malformed-record-payload/construct)
  (:result-type (constant RecordDef)))

(__form-hook malformed-record-payload/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output RecordDef)
  (:body
    (construct/declaration
      :kind "Record"
      :id "record:malformed"
      :entity "Employee"
      :fields (construct/object "" "bad")
      :$summary (construct/summary
        :kind "Record"
        :name "record:malformed"
        :resultType "RecordDef"))))

(define-malformed-record-payload malformed-record-payload)
`;

const malformedEntityPayloadSourceId = "emit/malformed-entity-payload";
const malformedEntityPayloadSource = `
(__form-descriptor define-malformed-entity-payload
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:required-fields [kind]) (:string-fields [kind]))))
  (:construct-fn malformed-entity-payload/construct)
  (:result-type (constant SchemaDecl)))

(__form-hook malformed-entity-payload/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output SchemaDecl)
  (:body
    (construct/declaration
      :kind "Entity"
      :name "MalformedEntity"
      :fieldTypes (construct/object "" "String")
      :fields [(construct/object :name "" :type "String")]
      :$summary (construct/summary
        :kind "Entity"
        :name "MalformedEntity"
        :resultType "SchemaDecl"))))

(define-malformed-entity-payload malformed-entity-payload)
`;

const malformedEdgePayloadSourceId = "emit/malformed-edge-payload";
const malformedEdgePayloadSource = `
(__form-descriptor define-malformed-edge-payload
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:required-fields [kind]) (:string-fields [kind]))))
  (:construct-fn malformed-edge-payload/construct)
  (:result-type (constant RelationDef)))

(__form-hook malformed-edge-payload/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output RelationDef)
  (:body
    (construct/declaration
      :kind "Relation"
      :name "malformed-edge"
      :source "Employee"
      :target "Department"
      :fields [(construct/object :name "" :type "String")]
      :$summary (construct/summary
        :kind "Relation"
        :name "malformed-edge"
        :resultType "RelationDef"))))

(define-malformed-edge-payload malformed-edge-payload)
`;

const malformedLinkPayloadSourceId = "emit/malformed-link-payload";
const malformedLinkPayloadSource = `
(__form-descriptor define-malformed-link-payload
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:required-fields [kind]) (:string-fields [kind]))))
  (:construct-fn malformed-link-payload/construct)
  (:result-type (constant LinkDef)))

(__form-hook malformed-link-payload/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output LinkDef)
  (:body
    (construct/declaration
      :kind "Link"
      :relation "employee-department"
      :source "Employee"
      :target "Department"
      :fields [(construct/object :name "" :value "employee:1")]
      :$summary (construct/summary
        :kind "Link"
        :name "malformed-link"
        :resultType "LinkDef"))))

(define-malformed-link-payload malformed-link-payload)
`;

const malformedOperationPayloadSourceId = "emit/malformed-operation-payload";
const malformedOperationPayloadSource = `
(__form-descriptor define-malformed-operation-payload
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:required-fields [kind]) (:string-fields [kind]))))
  (:construct-fn malformed-operation-payload/construct)
  (:result-type (constant ActionDef)))

(__form-hook malformed-operation-payload/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output ActionDef)
  (:body
    (construct/declaration
      :kind "Action"
      :name "malformed-operation"
      :inputs [(construct/object :name "" :type "String")]
      :do (construct/object :kind "noop")
      :$summary (construct/summary
        :kind "Action"
        :name "malformed-operation"
        :resultType "ActionDef"))))

(define-malformed-operation-payload malformed-operation-payload)
`;

const malformedSurfacePayloadSourceId = "emit/malformed-surface-payload";
const malformedSurfacePayloadSource = `
(__form-descriptor define-malformed-surface-payload
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:required-fields [kind]) (:string-fields [kind]))))
  (:construct-fn malformed-surface-payload/construct)
  (:result-type (constant ViewDef)))

(__form-hook malformed-surface-payload/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output ViewDef)
  (:body
    (construct/declaration
      :kind "View"
      :name "malformed-surface"
      :columns [(construct/object :name "" :label "Broken")]
      :$summary (construct/summary
        :kind "View"
        :name "malformed-surface"
        :resultType "ViewDef"))))

(define-malformed-surface-payload malformed-surface-payload)
`;

const malformedWorkspacePayloadSourceId = "emit/malformed-workspace-payload";
const malformedWorkspacePayloadSource = `
(__form-descriptor define-malformed-workspace-payload
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:required-fields [kind]) (:string-fields [kind]))))
  (:construct-fn malformed-workspace-payload/construct)
  (:result-type (constant WorkspaceDef)))

(__form-hook malformed-workspace-payload/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output WorkspaceDef)
  (:body
    (construct/declaration
      :kind "Workspace"
      :name "malformed-workspace"
      :views [""]
      :$summary (construct/summary
        :kind "Workspace"
        :name "malformed-workspace"
        :resultType "WorkspaceDef"))))

(define-malformed-workspace-payload malformed-workspace-payload)
`;

const malformedRulePayloadSourceId = "emit/malformed-rule-payload";
const malformedRulePayloadSource = `
(__form-descriptor define-malformed-rule-payload
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:required-fields [kind]) (:string-fields [kind]))))
  (:construct-fn malformed-rule-payload/construct)
  (:result-type (constant ConstraintDef)))

(__form-hook malformed-rule-payload/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output ConstraintDef)
  (:body
    (construct/declaration
      :kind "Constraint"
      :name "malformed-rule"
      :entity "Employee"
      :severity "error"
      :when (construct/object :kind "query")
      :message "Broken rule"
      :resolutions [(construct/object :label 42)]
      :$summary (construct/summary
        :kind "Constraint"
        :name "malformed-rule"
        :resultType "ConstraintDef"))))

(define-malformed-rule-payload malformed-rule-payload)
`;

const malformedWorkflowPayloadSourceId = "emit/malformed-workflow-payload";
const malformedWorkflowPayloadSource = `
(__form-descriptor define-malformed-workflow-payload
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:required-fields [kind]) (:string-fields [kind]))))
  (:construct-fn malformed-workflow-payload/construct)
  (:result-type (constant ProcessDef)))

(__form-hook malformed-workflow-payload/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output ProcessDef)
  (:body
    (construct/declaration
      :kind "Process"
      :name "malformed-workflow"
      :trigger (construct/object :kind "Trigger" :triggerKind "manual")
      :nodes [(construct/object :kind "Node" :id "")]
      :edges []
      :$summary (construct/summary
        :kind "Process"
        :name "malformed-workflow"
        :resultType "ProcessDef"))))

(define-malformed-workflow-payload malformed-workflow-payload)
`;

const malformedTaskPayloadSourceId = "emit/malformed-task-payload";
const malformedTaskPayloadSource = `
(__form-descriptor define-malformed-task-payload
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:required-fields [kind]) (:string-fields [kind]))))
  (:construct-fn malformed-task-payload/construct)
  (:result-type (constant TaskDefinitionDef)))

(__form-hook malformed-task-payload/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output TaskDefinitionDef)
  (:body
    (construct/declaration
      :kind "TaskDefinition"
      :name "malformed-task"
      :title "Malformed task"
      :inputs [(construct/object :name "" :type "String")]
      :$summary (construct/summary
        :kind "TaskDefinition"
        :name "malformed-task"
        :resultType "TaskDefinitionDef"))))

(define-malformed-task-payload malformed-task-payload)
`;

const malformedContentPayloadSourceId = "emit/malformed-content-payload";
const malformedContentPayloadSource = `
(__form-descriptor define-malformed-content-payload
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:required-fields [kind]) (:string-fields [kind]))))
  (:construct-fn malformed-content-payload/construct)
  (:result-type (constant DocumentDef)))

(__form-hook malformed-content-payload/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output DocumentDef)
  (:body
    (construct/declaration
      :kind "Document"
      :name "malformed-content"
      :pages [(construct/object :kind "Page" :assignee "" :fields [])]
      :$summary (construct/summary
        :kind "Document"
        :name "malformed-content"
        :resultType "DocumentDef"))))

(define-malformed-content-payload malformed-content-payload)
`;

const malformedContentLocalePayloadSourceId = "emit/malformed-content-locale-payload";
const malformedContentLocalePayloadSource = `
(__form-descriptor define-malformed-content-locale-payload
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:required-fields [kind]) (:string-fields [kind]))))
  (:construct-fn malformed-content-locale-payload/construct)
  (:result-type (constant DocumentLocaleDef)))

(__form-hook malformed-content-locale-payload/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output DocumentLocaleDef)
  (:body
    (construct/declaration
      :kind "DocumentLocale"
      :documentName "malformed-content"
      :locale "en"
      :roles [(construct/object :name nil :label "Broken role")]
      :sections []
      :fields []
      :$summary (construct/summary
        :kind "DocumentLocale"
        :name "malformed-content-locale"
        :resultType "DocumentLocaleDef"))))

(define-malformed-content-locale-payload malformed-content-locale-payload)
`;

const malformedContentLocalizedPayloadSourceId = "emit/malformed-content-localized-payload";
const malformedContentLocalizedPayloadSource = `
(__form-descriptor define-malformed-content-localized-payload
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:required-fields [kind]) (:string-fields [kind]))))
  (:construct-fn malformed-content-localized-payload/construct)
  (:result-type (constant DocumentLocalizedDef)))

(__form-hook malformed-content-localized-payload/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output DocumentLocalizedDef)
  (:body
    (construct/declaration
      :kind "DocumentLocalized"
      :documentName "malformed-content"
      :locales [""]
      :$summary (construct/summary
        :kind "DocumentLocalized"
        :name "malformed-content-localized"
        :resultType "DocumentLocalizedDef"))))

(define-malformed-content-localized-payload malformed-content-localized-payload)
`;

const malformedContentMappingPayloadSourceId = "emit/malformed-content-mapping-payload";
const malformedContentMappingPayloadSource = `
(__form-descriptor define-malformed-content-mapping-payload
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:required-fields [kind]) (:string-fields [kind]))))
  (:construct-fn malformed-content-mapping-payload/construct)
  (:result-type (constant PdfMappingDef)))

(__form-hook malformed-content-mapping-payload/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output PdfMappingDef)
  (:body
    (construct/declaration
      :kind "PdfMapping"
      :name "malformed-content-mapping"
      :templateBlob "sha256-placeholder"
      :mappings [(construct/object
        :kind "Switch"
        :source "status"
        :cases [(construct/object
          :when "active"
          :assignments [(construct/object :pdfField "Active Checkbox")])])]
      :$summary (construct/summary
        :kind "PdfMapping"
        :name "malformed-content-mapping"
        :resultType "PdfMappingDef"))))

(define-malformed-content-mapping-payload malformed-content-mapping-payload)
`;

const mismatchedPayloadKindSourceId = "emit/mismatched-payload-kind";
const mismatchedPayloadKindSource = `
(__form-descriptor define-mismatched-payload-kind
  (:identifier name)
  (:extensions
    (:artifact
      (:payload
        (:required-fields [kind name])
        (:literal-fields [[kind "ExpectedPayloadKind"]]))))
  (:construct-fn mismatched-payload-kind/construct)
  (:result-type (constant MismatchedPayloadKindDef)))

(__form-hook mismatched-payload-kind/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output MismatchedPayloadKindDef)
  (:body
    (construct/declaration
      :kind "ActualPayloadKind"
      :name (meta/declaration-name input)
      :$summary (construct/summary
        :kind "ActualPayloadKind"
        :name (meta/declaration-name input)
        :resultType "MismatchedPayloadKindDef"))))

(define-mismatched-payload-kind mismatched-payload-kind)
`;

const mismatchedPayloadFieldKindSourceId = "emit/mismatched-payload-field-kind";
const mismatchedPayloadFieldKindSource = `
(__form-descriptor define-mismatched-payload-field-kind
  (:identifier name)
  (:extensions
    (:artifact
      (:payload
        (:required-fields [kind name metadata])
        (:object-fields [metadata]))))
  (:construct-fn mismatched-payload-field-kind/construct)
  (:result-type (constant MismatchedPayloadFieldKindDef)))

(__form-hook mismatched-payload-field-kind/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output MismatchedPayloadFieldKindDef)
  (:body
    (construct/declaration
      :kind "MismatchedPayloadFieldKind"
      :name (meta/declaration-name input)
      :metadata "not-an-object"
      :$summary (construct/summary
        :kind "MismatchedPayloadFieldKind"
        :name (meta/declaration-name input)
        :resultType "MismatchedPayloadFieldKindDef"))))

(define-mismatched-payload-field-kind mismatched-payload-field-kind)
`;

const conflictingPayloadFieldKindSourceId = "emit/conflicting-payload-field-kind";
const conflictingPayloadFieldKindSource = `
(__form-descriptor define-conflicting-payload-field-kind
  (:identifier name)
  (:extensions
    (:artifact
      (:payload
        (:required-fields [kind name metadata])
        (:string-fields [metadata])
        (:object-fields [metadata]))))
  (:construct-fn conflicting-payload-field-kind/construct)
  (:result-type (constant ConflictingPayloadFieldKindDef)))

(__form-hook conflicting-payload-field-kind/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output ConflictingPayloadFieldKindDef)
  (:body
    (construct/declaration
      :kind "ConflictingPayloadFieldKind"
      :name (meta/declaration-name input)
      :metadata (construct/object :source "descriptor")
      :$summary (construct/summary
        :kind "ConflictingPayloadFieldKind"
        :name (meta/declaration-name input)
        :resultType "ConflictingPayloadFieldKindDef"))))

(define-conflicting-payload-field-kind conflicting-payload-field-kind)
`;

const literalPayloadObjectFieldSourceId = "emit/literal-payload-object-field";
const literalPayloadObjectFieldSource = `
(__form-descriptor define-literal-payload-object-field
  (:identifier name)
  (:extensions
    (:artifact
      (:payload
        (:required-fields [kind name metadata])
        (:literal-fields [[metadata "expected"]])
        (:object-fields [metadata]))))
  (:construct-fn literal-payload-object-field/construct)
  (:result-type (constant LiteralPayloadObjectFieldDef)))

(__form-hook literal-payload-object-field/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output LiteralPayloadObjectFieldDef)
  (:body
    (construct/declaration
      :kind "LiteralPayloadObjectField"
      :name (meta/declaration-name input)
      :metadata (construct/object :source "descriptor")
      :$summary (construct/summary
        :kind "LiteralPayloadObjectField"
        :name (meta/declaration-name input)
        :resultType "LiteralPayloadObjectFieldDef"))))

(define-literal-payload-object-field literal-payload-object-field)
`;

const unknownPayloadClauseSourceId = "emit/unknown-payload-clause";
const unknownPayloadClauseSource = `
(__form-descriptor define-unknown-payload-clause
  (:identifier name)
  (:extensions
    (:artifact
      (:payload
        (:required-fieldz [kind name])
        (:string-fields [kind name]))))
  (:construct-fn unknown-payload-clause/construct)
  (:result-type (constant UnknownPayloadClauseDef)))

(__form-hook unknown-payload-clause/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output UnknownPayloadClauseDef)
  (:body
    (construct/declaration
      :kind "UnknownPayloadClause"
      :name (meta/declaration-name input)
      :$summary (construct/summary
        :kind "UnknownPayloadClause"
        :name (meta/declaration-name input)
        :resultType "UnknownPayloadClauseDef"))))

(define-unknown-payload-clause unknown-payload-clause)
`;

const payloadContractAliasSourceId = "emit/payload-contract-alias";
const payloadContractAliasSource = `
(__payload-contract BasePayloadContract
  (:required-fields [kind name])
  (:string-fields [kind name]))

(__payload-contract MetadataPayloadContract
  (:required-fields [metadata])
  (:object-fields [metadata]))

(__payload-contract TagsPayloadContract
  (:required-fields [tags])
  (:array-fields [tags]))

(__payload-contract SharedPayloadContract
  (:contract [BasePayloadContract MetadataPayloadContract])
  (:literal-fields [[kind "SharedPayload"]]))

(__form-descriptor define-payload-contract-alias
  (:identifier name)
  (:extensions
    (:artifact
      (:payload
        (:contract [SharedPayloadContract TagsPayloadContract]))))
  (:construct-fn payload-contract-alias/construct)
  (:result-type (constant PayloadContractAliasDef)))

(__form-hook payload-contract-alias/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output PayloadContractAliasDef)
  (:body
    (construct/declaration
      :kind "SharedPayload"
      :name (meta/declaration-name input)
      :metadata (construct/object :source "contract")
      :tags ["shared"]
      :$summary (construct/summary
        :kind "SharedPayload"
        :name (meta/declaration-name input)
        :resultType "PayloadContractAliasDef"))))

(define-payload-contract-alias payload-contract-alias)
`;

const unknownPayloadContractSourceId = "emit/unknown-payload-contract";
const unknownPayloadContractSource = `
(__form-descriptor define-unknown-payload-contract
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:contract MissingPayloadContract))))
  (:construct-fn unknown-payload-contract/construct)
  (:result-type (constant UnknownPayloadContractDef)))

(__form-hook unknown-payload-contract/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output UnknownPayloadContractDef)
  (:body
    (construct/declaration
      :kind "UnknownPayloadContract"
      :name (meta/declaration-name input)
      :$summary (construct/summary
        :kind "UnknownPayloadContract"
        :name (meta/declaration-name input)
        :resultType "UnknownPayloadContractDef"))))

(define-unknown-payload-contract unknown-payload-contract)
`;

const recursivePayloadContractSourceId = "emit/recursive-payload-contract";
const recursivePayloadContractSource = `
(__payload-contract RecursivePayloadContract
  (:contract RecursivePayloadContract)
  (:required-fields [kind name])
  (:string-fields [kind name]))

(__form-descriptor define-recursive-payload-contract
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:contract RecursivePayloadContract))))
  (:construct-fn recursive-payload-contract/construct)
  (:result-type (constant RecursivePayloadContractDef)))

(__form-hook recursive-payload-contract/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output RecursivePayloadContractDef)
  (:body
    (construct/declaration
      :kind "RecursivePayloadContract"
      :name (meta/declaration-name input)
      :$summary (construct/summary
        :kind "RecursivePayloadContract"
        :name (meta/declaration-name input)
        :resultType "RecursivePayloadContractDef"))))

(define-recursive-payload-contract recursive-payload-contract)
`;

const duplicatePayloadContractReferenceSourceId = "emit/duplicate-payload-contract-reference";
const duplicatePayloadContractReferenceSource = `
(__payload-contract DuplicatePayloadBase
  (:required-fields [kind name])
  (:string-fields [kind name]))

(__form-descriptor define-duplicate-payload-contract-reference
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:contract [DuplicatePayloadBase DuplicatePayloadBase]))))
  (:construct-fn duplicate-payload-contract-reference/construct)
  (:result-type (constant DuplicatePayloadContractReferenceDef)))

(__form-hook duplicate-payload-contract-reference/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output DuplicatePayloadContractReferenceDef)
  (:body
    (construct/declaration
      :kind "DuplicatePayloadContractReference"
      :name (meta/declaration-name input)
      :$summary (construct/summary
        :kind "DuplicatePayloadContractReference"
        :name (meta/declaration-name input)
        :resultType "DuplicatePayloadContractReferenceDef"))))

(define-duplicate-payload-contract-reference duplicate-payload-contract-reference)
`;

const conflictingInheritedPayloadContractSourceId = "emit/conflicting-inherited-payload-contract";
const conflictingInheritedPayloadContractSource = `
(__payload-contract StringMetadataPayload
  (:required-fields [kind name metadata])
  (:string-fields [kind name metadata]))

(__payload-contract ObjectMetadataPayload
  (:required-fields [metadata])
  (:object-fields [metadata]))

(__form-descriptor define-conflicting-inherited-payload-contract
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:contract [StringMetadataPayload ObjectMetadataPayload]))))
  (:construct-fn conflicting-inherited-payload-contract/construct)
  (:result-type (constant ConflictingInheritedPayloadContractDef)))

(__form-hook conflicting-inherited-payload-contract/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output ConflictingInheritedPayloadContractDef)
  (:body
    (construct/declaration
      :kind "ConflictingInheritedPayloadContract"
      :name (meta/declaration-name input)
      :metadata (construct/object :source "descriptor")
      :$summary (construct/summary
        :kind "ConflictingInheritedPayloadContract"
        :name (meta/declaration-name input)
        :resultType "ConflictingInheritedPayloadContractDef"))))

(define-conflicting-inherited-payload-contract conflicting-inherited-payload-contract)
`;

const malformedPayloadContractAliasSourceId = "emit/malformed-payload-contract-alias";
const malformedPayloadContractAliasSource = `
(__payload-contract MalformedPayloadContract
  not-a-payload-clause)

(__form-descriptor define-malformed-payload-contract-alias
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:contract MalformedPayloadContract))))
  (:construct-fn malformed-payload-contract-alias/construct)
  (:result-type (constant MalformedPayloadContractAliasDef)))

(__form-hook malformed-payload-contract-alias/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output MalformedPayloadContractAliasDef)
  (:body
    (construct/declaration
      :kind "MalformedPayloadContract"
      :name (meta/declaration-name input)
      :$summary (construct/summary
        :kind "MalformedPayloadContract"
        :name (meta/declaration-name input)
        :resultType "MalformedPayloadContractAliasDef"))))

(define-malformed-payload-contract-alias malformed-payload-contract-alias)
`;

const unvalidatedHttpShapeSourceId = "emit/unvalidated-http-shape";
const unvalidatedHttpShapeSource = `
(__form-descriptor define-unvalidated-http-schema
  (:identifier name)
  (:construct-fn unvalidated-http-schema/construct)
  (:result-type (constant SchemaDecl)))

(__form-hook unvalidated-http-schema/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output SchemaDecl)
  (:body
    (construct/declaration
      :kind "Schema"
      :name (meta/declaration-name input)
      :schema (construct/object
        :kind "Ref"
        :target "MissingSchema")
      :$summary (construct/summary
        :kind "Schema"
        :name (meta/declaration-name input)
        :resultType "SchemaDecl"))))

(define-unvalidated-http-schema unvalidated-http-schema)
`;

const descriptorValidatedHttpShapeSourceId = "emit/descriptor-validated-http-shape";
const descriptorValidatedHttpShapeSource = `
(__form-descriptor define-descriptor-validated-http-schema
  (:identifier name)
  (:extensions
    (:artifact
      (:validators [http])))
  (:construct-fn descriptor-validated-http-schema/construct)
  (:result-type (constant SchemaDecl)))

(__form-hook descriptor-validated-http-schema/construct
  (:kind construct)
  (:input FormMetaInput)
  (:output SchemaDecl)
  (:body
    (construct/declaration
      :kind "Schema"
      :name (meta/declaration-name input)
      :schema (construct/object
        :kind "Ref"
        :target "MissingSchema")
      :$summary (construct/summary
        :kind "Schema"
        :name (meta/declaration-name input)
        :resultType "SchemaDecl"))))

(define-descriptor-validated-http-schema descriptor-validated-http-schema)
`;

let sessionId;
let hardFailure;

try {
  const opened = await request({ op: "openSession" });
  expectOk("openSession", opened);
  sessionId = opened.value.sessionId;

  for (const prelude of preludes) {
    const response = await request({
      op: "loadPrelude",
      sessionId,
      ...prelude,
    });
    expectOk(`loadPrelude ${prelude.sourceId}`, response);
  }

  expectOk(
    "loadSource schema",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: schemaSourceId,
      source: schemaSource,
    }),
  );
  expectOk(
    "loadSource data",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: dataSourceId,
      source: dataSource,
    }),
  );
  expectOk(
    "loadSource people module",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: peopleModuleSourceId,
      source: peopleModuleSource,
    }),
  );
  expectOk(
    "loadSource hiring module",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: hiringModuleSourceId,
      source: hiringModuleSource,
    }),
  );
  expectOk(
    "loadSource invalid IR",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: invalidIrSourceId,
      source: invalidIrSource,
    }),
  );
  expectOk(
    "loadSource invalid summary",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: invalidSummarySourceId,
      source: invalidSummarySource,
    }),
  );
  expectOk(
    "loadSource invalid summary name",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: invalidSummaryNameSourceId,
      source: invalidSummaryNameSource,
    }),
  );
  expectOk(
    "loadSource invalid summary result type",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: invalidSummaryResultTypeSourceId,
      source: invalidSummaryResultTypeSource,
    }),
  );
  expectOk(
    "loadSource invalid masked summary",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: invalidMaskedSummarySourceId,
      source: invalidMaskedSummarySource,
    }),
  );
  expectOk(
    "loadSource implicit summary",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: implicitSummarySourceId,
      source: implicitSummarySource,
    }),
  );
  expectOk(
    "loadSource mismatched summary",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: mismatchedSummarySourceId,
      source: mismatchedSummarySource,
    }),
  );
  expectOk(
    "loadSource mismatched descriptor kind",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: mismatchedDescriptorKindSourceId,
      source: mismatchedDescriptorKindSource,
    }),
  );
  expectOk(
    "loadSource mismatched descriptor name",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: mismatchedDescriptorNameSourceId,
      source: mismatchedDescriptorNameSource,
    }),
  );
  expectOk(
    "loadSource mismatched summary result type",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: mismatchedSummaryResultTypeSourceId,
      source: mismatchedSummaryResultTypeSource,
    }),
  );
  expectOk(
    "loadSource payload result type",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: payloadResultTypeSourceId,
      source: payloadResultTypeSource,
    }),
  );
  expectOk(
    "loadSource unknown validator",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: unknownValidatorSourceId,
      source: unknownValidatorSource,
    }),
  );
  expectOk(
    "loadSource malformed validator",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: malformedValidatorSourceId,
      source: malformedValidatorSource,
    }),
  );
  expectOk(
    "loadSource duplicate validator",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: duplicateValidatorSourceId,
      source: duplicateValidatorSource,
    }),
  );
  expectOk(
    "loadSource malformed payload contract alias",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: malformedPayloadContractAliasSourceId,
      source: malformedPayloadContractAliasSource,
    }),
  );
  expectOk(
    "loadSource missing payload field",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: missingPayloadFieldSourceId,
      source: missingPayloadFieldSource,
    }),
  );
  expectOk(
    "loadSource object payload field",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: objectPayloadFieldSourceId,
      source: objectPayloadFieldSource,
    }),
  );
  expectOk(
    "loadSource typed payload field",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: typedPayloadFieldSourceId,
      source: typedPayloadFieldSource,
    }),
  );
  const typedMalformedPayloadSources = [
    {
      label: "malformed query payload",
      sourceId: malformedQueryPayloadSourceId,
      source: malformedQueryPayloadSource,
    },
    {
      label: "malformed record payload",
      sourceId: malformedRecordPayloadSourceId,
      source: malformedRecordPayloadSource,
    },
    {
      label: "malformed entity payload",
      sourceId: malformedEntityPayloadSourceId,
      source: malformedEntityPayloadSource,
    },
    {
      label: "malformed edge payload",
      sourceId: malformedEdgePayloadSourceId,
      source: malformedEdgePayloadSource,
    },
    {
      label: "malformed link payload",
      sourceId: malformedLinkPayloadSourceId,
      source: malformedLinkPayloadSource,
    },
    {
      label: "malformed operation payload",
      sourceId: malformedOperationPayloadSourceId,
      source: malformedOperationPayloadSource,
    },
    {
      label: "malformed surface payload",
      sourceId: malformedSurfacePayloadSourceId,
      source: malformedSurfacePayloadSource,
    },
    {
      label: "malformed workspace payload",
      sourceId: malformedWorkspacePayloadSourceId,
      source: malformedWorkspacePayloadSource,
    },
    {
      label: "malformed rule payload",
      sourceId: malformedRulePayloadSourceId,
      source: malformedRulePayloadSource,
    },
    {
      label: "malformed workflow payload",
      sourceId: malformedWorkflowPayloadSourceId,
      source: malformedWorkflowPayloadSource,
    },
    {
      label: "malformed task payload",
      sourceId: malformedTaskPayloadSourceId,
      source: malformedTaskPayloadSource,
    },
    {
      label: "malformed content payload",
      sourceId: malformedContentPayloadSourceId,
      source: malformedContentPayloadSource,
    },
    {
      label: "malformed content locale payload",
      sourceId: malformedContentLocalePayloadSourceId,
      source: malformedContentLocalePayloadSource,
    },
    {
      label: "malformed content localized payload",
      sourceId: malformedContentLocalizedPayloadSourceId,
      source: malformedContentLocalizedPayloadSource,
    },
    {
      label: "malformed content mapping payload",
      sourceId: malformedContentMappingPayloadSourceId,
      source: malformedContentMappingPayloadSource,
    },
  ];

  for (const sourceFixture of typedMalformedPayloadSources) {
    expectOk(
      `loadSource ${sourceFixture.label}`,
      await request({
        op: "loadSource",
        sessionId,
        sourceId: sourceFixture.sourceId,
        source: sourceFixture.source,
      }),
    );
  }
  expectOk(
    "loadSource mismatched payload kind",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: mismatchedPayloadKindSourceId,
      source: mismatchedPayloadKindSource,
    }),
  );
  expectOk(
    "loadSource mismatched payload field kind",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: mismatchedPayloadFieldKindSourceId,
      source: mismatchedPayloadFieldKindSource,
    }),
  );
  expectOk(
    "loadSource conflicting payload field kind",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: conflictingPayloadFieldKindSourceId,
      source: conflictingPayloadFieldKindSource,
    }),
  );
  expectOk(
    "loadSource literal payload object field",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: literalPayloadObjectFieldSourceId,
      source: literalPayloadObjectFieldSource,
    }),
  );
  expectOk(
    "loadSource unknown payload clause",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: unknownPayloadClauseSourceId,
      source: unknownPayloadClauseSource,
    }),
  );
  expectOk(
    "loadSource payload contract alias",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: payloadContractAliasSourceId,
      source: payloadContractAliasSource,
    }),
  );
  expectOk(
    "loadSource unknown payload contract",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: unknownPayloadContractSourceId,
      source: unknownPayloadContractSource,
    }),
  );
  expectOk(
    "loadSource recursive payload contract",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: recursivePayloadContractSourceId,
      source: recursivePayloadContractSource,
    }),
  );
  expectOk(
    "loadSource duplicate payload contract reference",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: duplicatePayloadContractReferenceSourceId,
      source: duplicatePayloadContractReferenceSource,
    }),
  );
  expectOk(
    "loadSource conflicting inherited payload contract",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: conflictingInheritedPayloadContractSourceId,
      source: conflictingInheritedPayloadContractSource,
    }),
  );
  expectOk(
    "loadSource malformed payload contract",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: malformedPayloadContractSourceId,
      source: malformedPayloadContractSource,
    }),
  );
  expectOk(
    "loadSource unvalidated http shape",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: unvalidatedHttpShapeSourceId,
      source: unvalidatedHttpShapeSource,
    }),
  );
  expectOk(
    "loadSource descriptor validated http shape",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: descriptorValidatedHttpShapeSourceId,
      source: descriptorValidatedHttpShapeSource,
    }),
  );

  const response = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceIds: [schemaSourceId, dataSourceId],
  });
  expectOk("emit", response);

  const value = response.value;
  const artifact = value?.artifacts?.[0];
  const content = artifact?.content;
  if (
    value?.backend !== "canonical-ir" ||
    value?.artifactCount !== 1 ||
    artifact?.name !== "ir.json" ||
    artifact?.mediaType !== "application/vnd.forma.ir+json" ||
    content?.irVersion !== "1" ||
    content?.kind !== "CanonicalIr" ||
    content?.engine?.name !== "forma-ocaml" ||
    content?.hashAlgorithm !== "md5" ||
    content?.sourceIds?.join(",") !== `${schemaSourceId},${dataSourceId}` ||
    typeof content?.sourceHashes?.[schemaSourceId] !== "string" ||
    typeof content?.sourceHashes?.[dataSourceId] !== "string" ||
    !content?.preludeIds?.includes("preludes/ontology.lisp") ||
    typeof content?.preludeHashes?.["preludes/ontology.lisp"] !== "string" ||
    content?.declarationCount !== 5 ||
    typeof content?.declarationsHash !== "string" ||
    content?.typeSummary?.declarationCount !== 5 ||
    content?.typeSummary?.resultTypes?.SchemaDecl !== 2 ||
    content?.typeSummary?.resultTypes?.["List<{:department Option<Id<Department>> :name String}>"] !== 1 ||
    content?.typeSummary?.resultTypes?.RecordDef !== 2 ||
    !Array.isArray(content?.derivedArtifacts) ||
    content.derivedArtifacts[0]?.kind !== "DerivedManifest" ||
    content.derivedArtifacts[0]?.target !== "manifest" ||
    content.derivedArtifacts[0]?.sourceIrVersion !== "1" ||
    content.derivedArtifacts[0]?.declarationCount !== 5 ||
    content.derivedArtifacts[0]?.declarations?.[2]?.resultType !== "List<{:department Option<Id<Department>> :name String}>" ||
    content.derivedArtifacts[0]?.declarations?.some(
      (declaration) => declaration?.kind === "Unknown" || declaration?.resultType == null,
    ) ||
    !Array.isArray(content?.declarationProvenance) ||
    content.declarationProvenance.length !== 5 ||
    !Array.isArray(content?.declarationTypeSummaries) ||
    content.declarationTypeSummaries.length !== 5 ||
    content.declarationTypeSummaries.some(
      (summary) => summary == null || summary.resultType == null,
    ) ||
    content.declarationProvenance[0]?.sourceId !== schemaSourceId ||
    content.declarationProvenance[0]?.formIndex !== 0 ||
    content.declarationProvenance[0]?.span?.startOffset !==
      schemaSource.indexOf("(entity Department") ||
    content.declarationProvenance[0]?.span?.startLine !== 2 ||
    content.declarationProvenance[0]?.span?.startColumn !== 1 ||
    content.declarationProvenance[0]?.span?.endOffset <=
      content.declarationProvenance[0]?.span?.startOffset ||
    content.declarationProvenance[2]?.sourceId !== schemaSourceId ||
    content.declarationProvenance[2]?.formIndex !== 2 ||
    content.declarationProvenance[3]?.sourceId !== dataSourceId ||
    content.declarationProvenance[3]?.formIndex !== 0 ||
    content.declarationProvenance[3]?.span?.startOffset !== dataSource.indexOf("(seed Department") ||
    content.declarationProvenance[3]?.span?.startLine !== 2 ||
    content.declarationProvenance[3]?.span?.startColumn !== 1 ||
    !Array.isArray(content?.declarations) ||
    content.declarations.length !== 5 ||
    content.declarations.some((declaration) =>
      Object.prototype.hasOwnProperty.call(declaration, "$summary"),
    )
  ) {
    throw new Error(`Unexpected canonical-ir artifact:\n${JSON.stringify(response, null, 2)}`);
  }

  const [department, employee, query, departmentRecord, employeeRecord] = content.declarations;
  const [departmentType, employeeType, queryType, departmentRecordType, employeeRecordType] =
    content.declarationTypeSummaries;
  if (
    department?.kind !== "Entity" ||
    employee?.kind !== "Entity" ||
    query?.kind !== "Query" ||
    departmentRecord?.kind !== "Record" ||
    employeeRecord?.kind !== "Record"
  ) {
    throw new Error(`Unexpected declaration ordering:\n${JSON.stringify(content, null, 2)}`);
  }
  if (
    departmentType?.resultType !== "SchemaDecl" ||
    employeeType?.resultType !== "SchemaDecl" ||
    queryType?.resultType !== "List<{:department Option<Id<Department>> :name String}>" ||
    departmentRecordType?.resultType !== "RecordDef" ||
    employeeRecordType?.resultType !== "RecordDef"
  ) {
    throw new Error(`Unexpected declaration type summaries:\n${JSON.stringify(content, null, 2)}`);
  }
  if (
    employee.fields?.find(field=>field.name==="employee/name")?.type !== "String" ||
    employee.fields?.find(field=>field.name==="employee/department")?.type?.[0] !== "Id" ||
    employee.fields?.find(field=>field.name==="employee/department")?.type?.[1] !== "Department"
  ) {
    throw new Error(`Unexpected entity field types:\n${JSON.stringify(employee, null, 2)}`);
  }
  if (query.where?.kind !== "raw-expr" || query.where.expr?.[0] !== "=" || query.select?.join(",") !== "employee/name,employee/department") {
    throw new Error(`Unexpected checked query: ${JSON.stringify(query)}`);
  }

  const moduleResponse = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceIds: [peopleModuleSourceId, hiringModuleSourceId],
  });
  expectOk("emit modules", moduleResponse);
  const moduleContent = moduleResponse.value?.artifacts?.[0]?.content;
  const modules = moduleContent?.modules;
  if (
    !Array.isArray(modules) ||
    modules.length !== 2 ||
    modules[0]?.moduleId !== peopleModuleSourceId ||
    modules[0]?.exports?.[0]?.localName !== "Person" ||
    modules[0]?.exports?.[0]?.kind !== "Entity" ||
    modules[0]?.declarations?.[0]?.canonicalName !== `${peopleModuleSourceId}/Person` ||
    modules[1]?.moduleId !== hiringModuleSourceId ||
    modules[1]?.usedPreludes?.[0]?.prelude !== "ontology.alpha" ||
    modules[1]?.imports?.[0]?.specifier !== "./people.md" ||
    modules[1]?.imports?.[0]?.resolvedPath !== peopleModuleSourceId ||
    modules[1]?.imports?.[0]?.moduleId !== peopleModuleSourceId ||
    modules[1]?.imports?.[0]?.mode !== "alias" ||
    modules[1]?.imports?.[0]?.alias !== "people" ||
    modules[1]?.exports?.[0]?.canonicalName !== `${hiringModuleSourceId}/Candidate`
  ) {
    throw new Error(
      `Unexpected module metadata in canonical-ir artifact:\n${JSON.stringify(
        moduleResponse,
        null,
        2,
      )}`,
    );
  }

  const badHiringSourceId = "bad-hiring.md";
  expectOk(
    "load bad hiring module",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: badHiringSourceId,
      source: `
(import "./people.md" :as people)
(export Candidate)

(entity Candidate {:person (Option (Id people/Employee))})
`,
    }),
  );
  const badModuleResponse = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceIds: [peopleModuleSourceId, badHiringSourceId],
  });
  expectOk("emit bad modules", badModuleResponse);
  const badModules = badModuleResponse.value?.artifacts?.[0]?.content?.modules;
  const badHiringModule = badModules?.find((module) => module.moduleId === badHiringSourceId);
  if (
    !badHiringModule?.diagnostics?.some(
      (diagnostic) => diagnostic.code === "module.reference.unbound",
    )
  ) {
    throw new Error(
      `Expected module.reference.unbound diagnostic for bad alias reference:\n${JSON.stringify(
        badModuleResponse,
        null,
        2,
      )}`,
    );
  }

  const missingExportSourceId = "missing-export.md";
  expectOk(
    "load missing export module",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: missingExportSourceId,
      source: `
(import "./people.md" [Employee])

(entity Candidate {:person (Option (Id Employee))})
`,
    }),
  );
  const missingExportResponse = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceIds: [peopleModuleSourceId, missingExportSourceId],
  });
  expectOk("emit missing export modules", missingExportResponse);
  const missingExportModule = missingExportResponse.value?.artifacts?.[0]?.content?.modules?.find(
    (module) => module.moduleId === missingExportSourceId,
  );
  const missingExportDiagnostic = missingExportModule?.diagnostics?.find(
    (diagnostic) => diagnostic.code === "module.import.missing-export",
  );
  if (
    missingExportDiagnostic?.notes?.[0]?.message !== `Target module: ${peopleModuleSourceId}` ||
    missingExportDiagnostic?.notes?.[1]?.message !== "Available exports: Person"
  ) {
    throw new Error(
      `Expected missing export diagnostic notes:\n${JSON.stringify(
        missingExportResponse,
        null,
        2,
      )}`,
    );
  }

  const contractorModuleSourceId = "contractors.md";
  expectOk(
    "load contractor module",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: contractorModuleSourceId,
      source: `
(export Person)

(entity Person {:vendor (Option String)})
`,
    }),
  );
  const ambiguousHiringSourceId = "ambiguous-hiring.md";
  expectOk(
    "load ambiguous hiring module",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: ambiguousHiringSourceId,
      source: `
(import "./people.md" [Person])
(import "./contractors.md" [Person])

(entity Candidate {:person (Option (Id Person))})
`,
    }),
  );
  const ambiguousModuleResponse = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceIds: [peopleModuleSourceId, contractorModuleSourceId, ambiguousHiringSourceId],
  });
  expectOk("emit ambiguous modules", ambiguousModuleResponse);
  const ambiguousHiringModule =
    ambiguousModuleResponse.value?.artifacts?.[0]?.content?.modules?.find(
      (module) => module.moduleId === ambiguousHiringSourceId,
    );
  if (
    !ambiguousHiringModule?.diagnostics?.some(
      (diagnostic) => diagnostic.code === "module.reference.ambiguous",
    )
  ) {
    throw new Error(
      `Expected module.reference.ambiguous diagnostic for refer imports:\n${JSON.stringify(
        ambiguousModuleResponse,
        null,
        2,
      )}`,
    );
  }

  const singleModuleSourceId = "single-module.md";
  expectOk(
    "load single module",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: singleModuleSourceId,
      source: `
(entity Standalone {:name (Option String)})
`,
    }),
  );
  const singleModuleResponse = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceIds: [singleModuleSourceId],
  });
  expectOk("emit single module", singleModuleResponse);
  const singleModule = singleModuleResponse.value?.artifacts?.[0]?.content?.modules?.[0];
  if (singleModule?.exports?.[0]?.localName !== "Standalone") {
    throw new Error(
      `Expected single module to export declarations by default:\n${JSON.stringify(
        singleModuleResponse,
        null,
        2,
      )}`,
    );
  }

  const packageAllSourceId = "package-all.md";
  expectOk(
    "load package all module",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: packageAllSourceId,
      source: `
(use missing.alpha)
(import "@company/hr" :all)
(export Candidate)

(entity Candidate {:name (Option String)})
`,
    }),
  );
  const packageAllResponse = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceIds: [packageAllSourceId],
  });
  expectOk("emit package all module", packageAllResponse);
  const packageAllModule = packageAllResponse.value?.artifacts?.[0]?.content?.modules?.[0];
  if (
    !packageAllModule?.diagnostics?.some(
      (diagnostic) => diagnostic.code === "module.import.all-non-local",
    ) ||
    !packageAllModule?.diagnostics?.some(
      (diagnostic) => diagnostic.code === "module.use.unknown-prelude",
    )
  ) {
    throw new Error(
      `Expected module diagnostics for package :all import and unknown prelude:\n${JSON.stringify(
        packageAllResponse,
        null,
        2,
      )}`,
    );
  }

  const malformedModuleSourceId = "malformed-module.md";
  expectOk(
    "load malformed module directives",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: malformedModuleSourceId,
      source: `
(use)
(import "./people.md")
(export)
(export-from "./people.md" Person)

(entity Candidate {:name (Option String)})
`,
    }),
  );
  const malformedModuleResponse = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceIds: [malformedModuleSourceId],
  });
  expectOk("emit malformed module directives", malformedModuleResponse);
  const malformedModule = malformedModuleResponse.value?.artifacts?.[0]?.content?.modules?.[0];
  const malformedModuleCodes = malformedModule?.diagnostics?.map((diagnostic) => diagnostic.code);
  for (const code of [
    "module.use.malformed",
    "module.import.malformed",
    "module.export.malformed",
    "module.export-from.malformed",
  ]) {
    if (!malformedModuleCodes?.includes(code)) {
      throw new Error(
        `Expected malformed module diagnostic ${code}:\n${JSON.stringify(
          malformedModuleResponse,
          null,
          2,
        )}`,
      );
    }
  }

  const backends = await request({ op: "emitBackends" });
  if (
    backends?.ok !== true ||
    backends.value?.defaultBackend !== "canonical-ir" ||
    backends.value?.backends?.[0]?.name !== "canonical-ir"
  ) {
    throw new Error(`Unexpected emit backend metadata:\n${JSON.stringify(backends, null, 2)}`);
  }

  const unsupported = await request({
    op: "emit",
    sessionId,
    backend: "typescript",
    sourceId: schemaSourceId,
  });
  if (
    unsupported?.ok !== false ||
    unsupported.diagnostics?.[0]?.code !== "abi/unsupported-backend"
  ) {
    throw new Error(
      `Expected unsupported backend diagnostic:\n${JSON.stringify(unsupported, null, 2)}`,
    );
  }

  const invalidIr = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: invalidIrSourceId,
  });
  const invalidIrDiagnostic = invalidIr?.diagnostics?.[0];
  if (
    invalidIr?.ok !== false ||
    invalidIrDiagnostic?.code !== "artifact/untyped-runtime-declaration" ||
    invalidIrDiagnostic?.span == null ||
    invalidIrDiagnostic.span.sourceId !== invalidIrSourceId ||
    invalidIrDiagnostic.span.startOffset !== invalidIrSource.indexOf("(define-invalid-ir bad)") ||
    invalidIrDiagnostic.span.endOffset <= invalidIrDiagnostic.span.startOffset
  ) {
    throw new Error(
      `Expected canonical IR validation diagnostic:\n${JSON.stringify(invalidIr, null, 2)}`,
    );
  }

  const invalidSummary = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: invalidSummarySourceId,
  });
  const invalidSummaryDiagnostic = invalidSummary?.diagnostics?.[0];
  if (
    invalidSummary?.ok !== false ||
    invalidSummaryDiagnostic?.code !== "artifact/missing-type-summary" ||
    invalidSummaryDiagnostic?.span == null ||
    invalidSummaryDiagnostic.span.sourceId !== invalidSummarySourceId ||
    invalidSummaryDiagnostic.span.startOffset !==
      invalidSummarySource.indexOf("(define-invalid-summary bad-summary)") ||
    invalidSummaryDiagnostic.span.endOffset <= invalidSummaryDiagnostic.span.startOffset ||
    !invalidSummaryDiagnostic.message?.includes(":kind")
  ) {
    throw new Error(
      `Expected missing declaration summary diagnostic:\n${JSON.stringify(
        invalidSummary,
        null,
        2,
      )}`,
    );
  }

  const invalidSummaryName = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: invalidSummaryNameSourceId,
  });
  const invalidSummaryNameDiagnostic = invalidSummaryName?.diagnostics?.[0];
  if (
    invalidSummaryName?.ok !== false ||
    invalidSummaryNameDiagnostic?.code !== "artifact/missing-type-summary" ||
    invalidSummaryNameDiagnostic?.span == null ||
    invalidSummaryNameDiagnostic.span.sourceId !== invalidSummaryNameSourceId ||
    invalidSummaryNameDiagnostic.span.startOffset !==
      invalidSummaryNameSource.indexOf("(define-invalid-summary-name bad-summary-name)") ||
    invalidSummaryNameDiagnostic.span.endOffset <= invalidSummaryNameDiagnostic.span.startOffset ||
    !invalidSummaryNameDiagnostic.message?.includes(":name")
  ) {
    throw new Error(
      `Expected missing declaration summary name diagnostic:\n${JSON.stringify(
        invalidSummaryName,
        null,
        2,
      )}`,
    );
  }

  const invalidSummaryResultType = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: invalidSummaryResultTypeSourceId,
  });
  const invalidSummaryResultTypeDiagnostic = invalidSummaryResultType?.diagnostics?.[0];
  if (
    invalidSummaryResultType?.ok !== false ||
    invalidSummaryResultTypeDiagnostic?.code !== "artifact/missing-type-summary" ||
    invalidSummaryResultTypeDiagnostic?.span == null ||
    invalidSummaryResultTypeDiagnostic.span.sourceId !== invalidSummaryResultTypeSourceId ||
    invalidSummaryResultTypeDiagnostic.span.startOffset !==
      invalidSummaryResultTypeSource.indexOf(
        "(define-invalid-summary-result-type bad-summary-result-type)",
      ) ||
    invalidSummaryResultTypeDiagnostic.span.endOffset <=
      invalidSummaryResultTypeDiagnostic.span.startOffset ||
    !invalidSummaryResultTypeDiagnostic.message?.includes(":resultType")
  ) {
    throw new Error(
      `Expected missing declaration summary result type diagnostic:\n${JSON.stringify(
        invalidSummaryResultType,
        null,
        2,
      )}`,
    );
  }

  const invalidMaskedSummary = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: invalidMaskedSummarySourceId,
  });
  const invalidMaskedSummaryDiagnostic = invalidMaskedSummary?.diagnostics?.[0];
  if (
    invalidMaskedSummary?.ok !== false ||
    invalidMaskedSummaryDiagnostic?.code !== "artifact/missing-type-summary" ||
    invalidMaskedSummaryDiagnostic?.span == null ||
    invalidMaskedSummaryDiagnostic.span.sourceId !== invalidMaskedSummarySourceId ||
    invalidMaskedSummaryDiagnostic.span.startOffset !==
      invalidMaskedSummarySource.indexOf("(define-invalid-masked-summary bad-masked-summary)") ||
    invalidMaskedSummaryDiagnostic.span.endOffset <=
      invalidMaskedSummaryDiagnostic.span.startOffset ||
    !invalidMaskedSummaryDiagnostic.message?.includes(":kind")
  ) {
    throw new Error(
      `Expected missing masked declaration summary diagnostic:\n${JSON.stringify(
        invalidMaskedSummary,
        null,
        2,
      )}`,
    );
  }

  const implicitSummary = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: implicitSummarySourceId,
  });
  const implicitSummaryDiagnostic = implicitSummary?.diagnostics?.[0];
  if (
    implicitSummary?.ok !== false ||
    implicitSummaryDiagnostic?.code !== "artifact/missing-type-summary" ||
    implicitSummaryDiagnostic?.span == null ||
    implicitSummaryDiagnostic.span.sourceId !== implicitSummarySourceId ||
    implicitSummaryDiagnostic.span.startOffset !==
      implicitSummarySource.indexOf("(define-implicit-summary inferred)") ||
    implicitSummaryDiagnostic.span.endOffset <= implicitSummaryDiagnostic.span.startOffset
  ) {
    throw new Error(
      `Expected missing declaration summary diagnostic:\n${JSON.stringify(
        implicitSummary,
        null,
        2,
      )}`,
    );
  }

  const mismatchedSummary = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: mismatchedSummarySourceId,
  });
  const mismatchedSummaryDiagnostic = mismatchedSummary?.diagnostics?.[0];
  if (
    mismatchedSummary?.ok !== false ||
    mismatchedSummaryDiagnostic?.code !== "artifact/summary-mismatch" ||
    mismatchedSummaryDiagnostic?.span == null ||
    mismatchedSummaryDiagnostic.span.sourceId !== mismatchedSummarySourceId ||
    mismatchedSummaryDiagnostic.span.startOffset !==
      mismatchedSummarySource.indexOf("(define-mismatched-summary bad-summary-mismatch)") ||
    mismatchedSummaryDiagnostic.span.endOffset <= mismatchedSummaryDiagnostic.span.startOffset ||
    !mismatchedSummaryDiagnostic.message?.includes("WrongSummaryKind") ||
    !mismatchedSummaryDiagnostic.message?.includes("ActualSummaryKind")
  ) {
    throw new Error(
      `Expected mismatched declaration summary diagnostic:\n${JSON.stringify(
        mismatchedSummary,
        null,
        2,
      )}`,
    );
  }

  const mismatchedDescriptorKind = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: mismatchedDescriptorKindSourceId,
  });
  const mismatchedDescriptorKindDiagnostic = mismatchedDescriptorKind?.diagnostics?.[0];
  if (
    mismatchedDescriptorKind?.ok !== false ||
    mismatchedDescriptorKindDiagnostic?.code !== "artifact/summary-mismatch" ||
    mismatchedDescriptorKindDiagnostic?.span == null ||
    mismatchedDescriptorKindDiagnostic.span.sourceId !== mismatchedDescriptorKindSourceId ||
    mismatchedDescriptorKindDiagnostic.span.startOffset !==
      mismatchedDescriptorKindSource.indexOf(
        "(define-mismatched-descriptor-kind bad-descriptor-kind-mismatch)",
      ) ||
    mismatchedDescriptorKindDiagnostic.span.endOffset <=
      mismatchedDescriptorKindDiagnostic.span.startOffset ||
    !mismatchedDescriptorKindDiagnostic.message?.includes("WrongDescriptorSummaryKind") ||
    !mismatchedDescriptorKindDiagnostic.message?.includes("DescriptorSummaryKind")
  ) {
    throw new Error(
      `Expected mismatched descriptor construct kind diagnostic:\n${JSON.stringify(
        mismatchedDescriptorKind,
        null,
        2,
      )}`,
    );
  }

  const mismatchedDescriptorName = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: mismatchedDescriptorNameSourceId,
  });
  const mismatchedDescriptorNameDiagnostic = mismatchedDescriptorName?.diagnostics?.[0];
  if (
    mismatchedDescriptorName?.ok !== false ||
    mismatchedDescriptorNameDiagnostic?.code !== "artifact/summary-mismatch" ||
    mismatchedDescriptorNameDiagnostic?.span == null ||
    mismatchedDescriptorNameDiagnostic.span.sourceId !== mismatchedDescriptorNameSourceId ||
    mismatchedDescriptorNameDiagnostic.span.startOffset !==
      mismatchedDescriptorNameSource.indexOf(
        "(define-mismatched-descriptor-name bad-descriptor-name-mismatch)",
      ) ||
    mismatchedDescriptorNameDiagnostic.span.endOffset <=
      mismatchedDescriptorNameDiagnostic.span.startOffset ||
    !mismatchedDescriptorNameDiagnostic.message?.includes("wrong-descriptor-name") ||
    !mismatchedDescriptorNameDiagnostic.message?.includes("bad-descriptor-name-mismatch")
  ) {
    throw new Error(
      `Expected mismatched descriptor declaration name diagnostic:\n${JSON.stringify(
        mismatchedDescriptorName,
        null,
        2,
      )}`,
    );
  }

  const mismatchedSummaryResultType = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: mismatchedSummaryResultTypeSourceId,
  });
  const mismatchedSummaryResultTypeDiagnostic = mismatchedSummaryResultType?.diagnostics?.[0];
  if (
    mismatchedSummaryResultType?.ok !== false ||
    mismatchedSummaryResultTypeDiagnostic?.code !== "artifact/summary-mismatch" ||
    mismatchedSummaryResultTypeDiagnostic?.span == null ||
    mismatchedSummaryResultTypeDiagnostic.span.sourceId !== mismatchedSummaryResultTypeSourceId ||
    mismatchedSummaryResultTypeDiagnostic.span.startOffset !==
      mismatchedSummaryResultTypeSource.indexOf(
        "(define-mismatched-summary-result-type bad-summary-result-mismatch)",
      ) ||
    mismatchedSummaryResultTypeDiagnostic.span.endOffset <=
      mismatchedSummaryResultTypeDiagnostic.span.startOffset ||
    !mismatchedSummaryResultTypeDiagnostic.message?.includes("WrongSummaryResultDef") ||
    !mismatchedSummaryResultTypeDiagnostic.message?.includes("ActualSummaryResultDef")
  ) {
    throw new Error(
      `Expected mismatched declaration result type summary diagnostic:\n${JSON.stringify(
        mismatchedSummaryResultType,
        null,
        2,
      )}`,
    );
  }

  const payloadResultType = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: payloadResultTypeSourceId,
  });
  expectOk("emit payload result type", payloadResultType);

  const payloadResultTypeContent = payloadResultType.value?.artifacts?.[0]?.content;
  if (
    payloadResultTypeContent?.declarationCount !== 1 ||
    payloadResultTypeContent?.declarations?.[0]?.kind !== "PayloadResultType" ||
    payloadResultTypeContent.declarations[0]?.resultType !== "PayloadShouldNotDriveSummary" ||
    payloadResultTypeContent?.declarationTypeSummaries?.[0]?.resultType !== "SummaryOnlyDef" ||
    payloadResultTypeContent?.derivedArtifacts?.[0]?.declarations?.[0]?.resultType !==
      "SummaryOnlyDef" ||
    payloadResultTypeContent?.typeSummary?.resultTypes?.SummaryOnlyDef !== 1 ||
    payloadResultTypeContent?.typeSummary?.resultTypes?.PayloadShouldNotDriveSummary != null
  ) {
    throw new Error(
      `Expected artifact summaries to use $summary, not payload resultType:\n${JSON.stringify(
        payloadResultType,
        null,
        2,
      )}`,
    );
  }

  const unknownValidator = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: unknownValidatorSourceId,
  });
  const unknownValidatorDiagnostic = unknownValidator?.diagnostics?.[0];
  if (
    unknownValidator?.ok !== false ||
    unknownValidatorDiagnostic?.code !== "artifact/unknown-validator" ||
    unknownValidatorDiagnostic?.span == null ||
    unknownValidatorDiagnostic.span.sourceId !== unknownValidatorSourceId ||
    unknownValidatorDiagnostic.span.startOffset !==
      unknownValidatorSource.indexOf("(define-unknown-validator unknown-validator)") ||
    unknownValidatorDiagnostic.span.endOffset <= unknownValidatorDiagnostic.span.startOffset ||
    !unknownValidatorDiagnostic.message?.includes("missing-validator")
  ) {
    throw new Error(
      `Expected unknown artifact validator diagnostic:\n${JSON.stringify(
        unknownValidator,
        null,
        2,
      )}`,
    );
  }

  const malformedValidator = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: malformedValidatorSourceId,
  });
  const malformedValidatorDiagnostic = malformedValidator?.diagnostics?.[0];
  if (
    malformedValidator?.ok !== false ||
    malformedValidatorDiagnostic?.code !== "artifact/descriptor-validators" ||
    malformedValidatorDiagnostic?.span == null ||
    malformedValidatorDiagnostic.span.sourceId !== malformedValidatorSourceId ||
    malformedValidatorDiagnostic.span.startOffset !==
      malformedValidatorSource.indexOf("(define-malformed-validator malformed-validator)") ||
    malformedValidatorDiagnostic.span.endOffset <= malformedValidatorDiagnostic.span.startOffset ||
    !malformedValidatorDiagnostic.message?.includes("textual")
  ) {
    throw new Error(
      `Expected malformed artifact validator descriptor diagnostic:\n${JSON.stringify(
        malformedValidator,
        null,
        2,
      )}`,
    );
  }

  const duplicateValidator = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: duplicateValidatorSourceId,
  });
  const duplicateValidatorDiagnostic = duplicateValidator?.diagnostics?.[0];
  if (
    duplicateValidator?.ok !== false ||
    duplicateValidatorDiagnostic?.code !== "artifact/descriptor-validators" ||
    duplicateValidatorDiagnostic?.span == null ||
    duplicateValidatorDiagnostic.span.sourceId !== duplicateValidatorSourceId ||
    duplicateValidatorDiagnostic.span.startOffset !==
      duplicateValidatorSource.indexOf("(define-duplicate-validator duplicate-validator)") ||
    duplicateValidatorDiagnostic.span.endOffset <= duplicateValidatorDiagnostic.span.startOffset ||
    !duplicateValidatorDiagnostic.message?.includes("repeat") ||
    !duplicateValidatorDiagnostic.message?.includes("http")
  ) {
    throw new Error(
      `Expected duplicate artifact validator descriptor diagnostic:\n${JSON.stringify(
        duplicateValidator,
        null,
        2,
      )}`,
    );
  }

  const malformedPayloadContract = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: malformedPayloadContractSourceId,
  });
  const malformedPayloadContractDiagnostic = malformedPayloadContract?.diagnostics?.[0];
  if (
    malformedPayloadContract?.ok !== false ||
    malformedPayloadContractDiagnostic?.code !== "artifact/descriptor-payload" ||
    malformedPayloadContractDiagnostic?.span == null ||
    malformedPayloadContractDiagnostic.span.sourceId !== malformedPayloadContractSourceId ||
    malformedPayloadContractDiagnostic.span.startOffset !==
      malformedPayloadContractSource.indexOf(
        "(define-malformed-payload-contract malformed-payload-contract)",
      ) ||
    malformedPayloadContractDiagnostic.span.endOffset <=
      malformedPayloadContractDiagnostic.span.startOffset ||
    !malformedPayloadContractDiagnostic.message?.includes("textual")
  ) {
    throw new Error(
      `Expected malformed artifact payload descriptor diagnostic:\n${JSON.stringify(
        malformedPayloadContract,
        null,
        2,
      )}`,
    );
  }

  const missingPayloadField = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: missingPayloadFieldSourceId,
  });
  const missingPayloadFieldDiagnostic = missingPayloadField?.diagnostics?.[0];
  if (
    missingPayloadField?.ok !== false ||
    missingPayloadFieldDiagnostic?.code !== "artifact/summary-mismatch" ||
    missingPayloadFieldDiagnostic?.span == null ||
    missingPayloadFieldDiagnostic.span.sourceId !== missingPayloadFieldSourceId ||
    missingPayloadFieldDiagnostic.span.startOffset !==
      missingPayloadFieldSource.indexOf("(define-missing-payload-field missing-payload-field)") ||
    missingPayloadFieldDiagnostic.span.endOffset <=
      missingPayloadFieldDiagnostic.span.startOffset ||
    !missingPayloadFieldDiagnostic.message?.includes("externalId") ||
    !missingPayloadFieldDiagnostic.message?.includes("descriptor artifact contract")
  ) {
    throw new Error(
      `Expected missing artifact payload field diagnostic:\n${JSON.stringify(
        missingPayloadField,
        null,
        2,
      )}`,
    );
  }

  const objectPayloadField = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: objectPayloadFieldSourceId,
  });
  expectOk("emit descriptor-required object payload field", objectPayloadField);
  const objectPayloadDeclaration =
    objectPayloadField.value?.artifacts?.[0]?.content?.declarations?.[0];
  if (
    objectPayloadDeclaration?.kind !== "ObjectPayloadField" ||
    objectPayloadDeclaration?.metadata?.source !== "descriptor"
  ) {
    throw new Error(
      `Expected descriptor-required object payload field to emit:\n${JSON.stringify(
        objectPayloadField,
        null,
        2,
      )}`,
    );
  }

  const typedPayloadField = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: typedPayloadFieldSourceId,
  });
  expectOk("emit descriptor-typed payload fields", typedPayloadField);
  const typedPayloadDeclaration =
    typedPayloadField.value?.artifacts?.[0]?.content?.declarations?.[0];
  if (
    typedPayloadDeclaration?.kind !== "TypedPayloadField" ||
    typedPayloadDeclaration?.metadata?.source !== "descriptor" ||
    typedPayloadDeclaration?.tags?.[0] !== "contract"
  ) {
    throw new Error(
      `Expected descriptor-typed payload fields to emit:\n${JSON.stringify(
        typedPayloadField,
        null,
        2,
      )}`,
    );
  }

  const typedMalformedPayloadCases = [
    {
      label: "typed query payload",
      sourceId: malformedQueryPayloadSourceId,
      source: malformedQueryPayloadSource,
      form: "(define-malformed-query-payload malformed-query-payload)",
      code: "artifact/query-payload",
      messageIncludes: ["from", "string"],
    },
    {
      label: "typed record payload",
      sourceId: malformedRecordPayloadSourceId,
      source: malformedRecordPayloadSource,
      form: "(define-malformed-record-payload malformed-record-payload)",
      code: "artifact/record-payload",
      messageIncludes: ["field names", "empty"],
    },
    {
      label: "typed entity payload",
      sourceId: malformedEntityPayloadSourceId,
      source: malformedEntityPayloadSource,
      form: "(define-malformed-entity-payload malformed-entity-payload)",
      code: "artifact/entity-payload",
      messageIncludes: ["fieldTypes", "empty"],
    },
    {
      label: "typed edge payload",
      sourceId: malformedEdgePayloadSourceId,
      source: malformedEdgePayloadSource,
      form: "(define-malformed-edge-payload malformed-edge-payload)",
      code: "artifact/edge-payload",
      messageIncludes: ["Relation field name", "empty"],
    },
    {
      label: "typed link payload",
      sourceId: malformedLinkPayloadSourceId,
      source: malformedLinkPayloadSource,
      form: "(define-malformed-link-payload malformed-link-payload)",
      code: "artifact/edge-payload",
      messageIncludes: ["Link field name", "empty"],
    },
    {
      label: "typed operation payload",
      sourceId: malformedOperationPayloadSourceId,
      source: malformedOperationPayloadSource,
      form: "(define-malformed-operation-payload malformed-operation-payload)",
      code: "artifact/operation-payload",
      messageIncludes: ["input name", "empty"],
    },
    {
      label: "typed surface payload",
      sourceId: malformedSurfacePayloadSourceId,
      source: malformedSurfacePayloadSource,
      form: "(define-malformed-surface-payload malformed-surface-payload)",
      code: "artifact/surface-payload",
      messageIncludes: ["column name", "empty"],
    },
    {
      label: "typed workspace payload",
      sourceId: malformedWorkspacePayloadSourceId,
      source: malformedWorkspacePayloadSource,
      form: "(define-malformed-workspace-payload malformed-workspace-payload)",
      code: "artifact/surface-payload",
      messageIncludes: ["view references", "empty"],
    },
    {
      label: "typed rule payload",
      sourceId: malformedRulePayloadSourceId,
      source: malformedRulePayloadSource,
      form: "(define-malformed-rule-payload malformed-rule-payload)",
      code: "artifact/rule-payload",
      messageIncludes: ["label", "string"],
    },
    {
      label: "typed workflow payload",
      sourceId: malformedWorkflowPayloadSourceId,
      source: malformedWorkflowPayloadSource,
      form: "(define-malformed-workflow-payload malformed-workflow-payload)",
      code: "artifact/workflow-payload",
      messageIncludes: ["node id", "empty"],
    },
    {
      label: "typed task payload",
      sourceId: malformedTaskPayloadSourceId,
      source: malformedTaskPayloadSource,
      form: "(define-malformed-task-payload malformed-task-payload)",
      code: "artifact/workflow-payload",
      messageIncludes: ["input name", "empty"],
    },
    {
      label: "typed content payload",
      sourceId: malformedContentPayloadSourceId,
      source: malformedContentPayloadSource,
      form: "(define-malformed-content-payload malformed-content-payload)",
      code: "artifact/content-payload",
      messageIncludes: ["assignee", "empty"],
    },
    {
      label: "typed content locale payload",
      sourceId: malformedContentLocalePayloadSourceId,
      source: malformedContentLocalePayloadSource,
      form: "(define-malformed-content-locale-payload malformed-content-locale-payload)",
      code: "artifact/content-payload",
      messageIncludes: ["name", "null"],
    },
    {
      label: "typed content localized payload",
      sourceId: malformedContentLocalizedPayloadSourceId,
      source: malformedContentLocalizedPayloadSource,
      form: "(define-malformed-content-localized-payload malformed-content-localized-payload)",
      code: "artifact/content-payload",
      messageIncludes: ["locales", "empty"],
    },
    {
      label: "typed content mapping payload",
      sourceId: malformedContentMappingPayloadSourceId,
      source: malformedContentMappingPayloadSource,
      form: "(define-malformed-content-mapping-payload malformed-content-mapping-payload)",
      code: "artifact/content-payload",
      messageIncludes: ["value", "include"],
    },
  ];

  for (const testCase of typedMalformedPayloadCases) {
    expectMalformedDiagnostic({
      ...testCase,
      response: await request({
        op: "emit",
        sessionId,
        backend: "canonical-ir",
        sourceId: testCase.sourceId,
      }),
    });
  }

  const mismatchedPayloadKind = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: mismatchedPayloadKindSourceId,
  });
  const mismatchedPayloadKindDiagnostic = mismatchedPayloadKind?.diagnostics?.[0];
  if (
    mismatchedPayloadKind?.ok !== false ||
    mismatchedPayloadKindDiagnostic?.code !== "artifact/summary-mismatch" ||
    mismatchedPayloadKindDiagnostic?.span == null ||
    mismatchedPayloadKindDiagnostic.span.sourceId !== mismatchedPayloadKindSourceId ||
    mismatchedPayloadKindDiagnostic.span.startOffset !==
      mismatchedPayloadKindSource.indexOf(
        "(define-mismatched-payload-kind mismatched-payload-kind)",
      ) ||
    !mismatchedPayloadKindDiagnostic.message?.includes("ExpectedPayloadKind")
  ) {
    throw new Error(
      `Expected mismatched payload literal diagnostic:\n${JSON.stringify(
        mismatchedPayloadKind,
        null,
        2,
      )}`,
    );
  }

  const mismatchedPayloadFieldKind = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: mismatchedPayloadFieldKindSourceId,
  });
  const mismatchedPayloadFieldKindDiagnostic = mismatchedPayloadFieldKind?.diagnostics?.[0];
  if (
    mismatchedPayloadFieldKind?.ok !== false ||
    mismatchedPayloadFieldKindDiagnostic?.code !== "artifact/summary-mismatch" ||
    mismatchedPayloadFieldKindDiagnostic?.span == null ||
    mismatchedPayloadFieldKindDiagnostic.span.sourceId !== mismatchedPayloadFieldKindSourceId ||
    mismatchedPayloadFieldKindDiagnostic.span.startOffset !==
      mismatchedPayloadFieldKindSource.indexOf(
        "(define-mismatched-payload-field-kind mismatched-payload-field-kind)",
      ) ||
    !mismatchedPayloadFieldKindDiagnostic.message?.includes("metadata") ||
    !mismatchedPayloadFieldKindDiagnostic.message?.includes("object")
  ) {
    throw new Error(
      `Expected mismatched payload field kind diagnostic:\n${JSON.stringify(
        mismatchedPayloadFieldKind,
        null,
        2,
      )}`,
    );
  }

  const conflictingPayloadFieldKind = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: conflictingPayloadFieldKindSourceId,
  });
  const conflictingPayloadFieldKindDiagnostic = conflictingPayloadFieldKind?.diagnostics?.[0];
  if (
    conflictingPayloadFieldKind?.ok !== false ||
    conflictingPayloadFieldKindDiagnostic?.code !== "artifact/descriptor-payload" ||
    conflictingPayloadFieldKindDiagnostic?.span == null ||
    conflictingPayloadFieldKindDiagnostic.span.sourceId !== conflictingPayloadFieldKindSourceId ||
    conflictingPayloadFieldKindDiagnostic.span.startOffset !==
      conflictingPayloadFieldKindSource.indexOf(
        "(define-conflicting-payload-field-kind conflicting-payload-field-kind)",
      ) ||
    !conflictingPayloadFieldKindDiagnostic.message?.includes("metadata") ||
    !conflictingPayloadFieldKindDiagnostic.message?.includes("conflicting kind")
  ) {
    throw new Error(
      `Expected conflicting payload field kind descriptor diagnostic:\n${JSON.stringify(
        conflictingPayloadFieldKind,
        null,
        2,
      )}`,
    );
  }

  const literalPayloadObjectField = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: literalPayloadObjectFieldSourceId,
  });
  const literalPayloadObjectFieldDiagnostic = literalPayloadObjectField?.diagnostics?.[0];
  if (
    literalPayloadObjectField?.ok !== false ||
    literalPayloadObjectFieldDiagnostic?.code !== "artifact/descriptor-payload" ||
    literalPayloadObjectFieldDiagnostic?.span == null ||
    literalPayloadObjectFieldDiagnostic.span.sourceId !== literalPayloadObjectFieldSourceId ||
    literalPayloadObjectFieldDiagnostic.span.startOffset !==
      literalPayloadObjectFieldSource.indexOf(
        "(define-literal-payload-object-field literal-payload-object-field)",
      ) ||
    !literalPayloadObjectFieldDiagnostic.message?.includes("literal field") ||
    !literalPayloadObjectFieldDiagnostic.message?.includes("metadata") ||
    !literalPayloadObjectFieldDiagnostic.message?.includes("object")
  ) {
    throw new Error(
      `Expected literal payload object field descriptor diagnostic:\n${JSON.stringify(
        literalPayloadObjectField,
        null,
        2,
      )}`,
    );
  }

  const unknownPayloadClause = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: unknownPayloadClauseSourceId,
  });
  const unknownPayloadClauseDiagnostic = unknownPayloadClause?.diagnostics?.[0];
  if (
    unknownPayloadClause?.ok !== false ||
    unknownPayloadClauseDiagnostic?.code !== "artifact/descriptor-payload" ||
    unknownPayloadClauseDiagnostic?.span == null ||
    unknownPayloadClauseDiagnostic.span.sourceId !== unknownPayloadClauseSourceId ||
    unknownPayloadClauseDiagnostic.span.startOffset !==
      unknownPayloadClauseSource.indexOf(
        "(define-unknown-payload-clause unknown-payload-clause)",
      ) ||
    !unknownPayloadClauseDiagnostic.message?.includes("required-fieldz") ||
    !unknownPayloadClauseDiagnostic.message?.includes("Unknown")
  ) {
    throw new Error(
      `Expected unknown payload clause descriptor diagnostic:\n${JSON.stringify(
        unknownPayloadClause,
        null,
        2,
      )}`,
    );
  }

  const payloadContractAlias = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: payloadContractAliasSourceId,
  });
  expectOk("emit descriptor payload contract alias", payloadContractAlias);
  const payloadContractAliasDeclaration =
    payloadContractAlias.value?.artifacts?.[0]?.content?.declarations?.[0];
  if (
    payloadContractAliasDeclaration?.kind !== "SharedPayload" ||
    payloadContractAliasDeclaration?.metadata?.source !== "contract" ||
    payloadContractAliasDeclaration?.tags?.[0] !== "shared"
  ) {
    throw new Error(
      `Expected descriptor payload contract alias to emit:\n${JSON.stringify(
        payloadContractAlias,
        null,
        2,
      )}`,
    );
  }

  const unknownPayloadContract = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: unknownPayloadContractSourceId,
  });
  const unknownPayloadContractDiagnostic = unknownPayloadContract?.diagnostics?.[0];
  if (
    unknownPayloadContract?.ok !== false ||
    unknownPayloadContractDiagnostic?.code !== "artifact/descriptor-payload" ||
    unknownPayloadContractDiagnostic?.span == null ||
    unknownPayloadContractDiagnostic.span.sourceId !== unknownPayloadContractSourceId ||
    unknownPayloadContractDiagnostic.span.startOffset !==
      unknownPayloadContractSource.indexOf(
        "(define-unknown-payload-contract unknown-payload-contract)",
      ) ||
    !unknownPayloadContractDiagnostic.message?.includes("MissingPayloadContract")
  ) {
    throw new Error(
      `Expected unknown payload contract descriptor diagnostic:\n${JSON.stringify(
        unknownPayloadContract,
        null,
        2,
      )}`,
    );
  }

  const recursivePayloadContract = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: recursivePayloadContractSourceId,
  });
  const recursivePayloadContractDiagnostic = recursivePayloadContract?.diagnostics?.[0];
  if (
    recursivePayloadContract?.ok !== false ||
    recursivePayloadContractDiagnostic?.code !== "artifact/descriptor-payload" ||
    recursivePayloadContractDiagnostic?.span == null ||
    recursivePayloadContractDiagnostic.span.sourceId !== recursivePayloadContractSourceId ||
    recursivePayloadContractDiagnostic.span.startOffset !==
      recursivePayloadContractSource.indexOf(
        "(define-recursive-payload-contract recursive-payload-contract)",
      ) ||
    !recursivePayloadContractDiagnostic.message?.includes("RecursivePayloadContract") ||
    !recursivePayloadContractDiagnostic.message?.includes("recursive")
  ) {
    throw new Error(
      `Expected recursive payload contract descriptor diagnostic:\n${JSON.stringify(
        recursivePayloadContract,
        null,
        2,
      )}`,
    );
  }

  const duplicatePayloadContractReference = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: duplicatePayloadContractReferenceSourceId,
  });
  const duplicatePayloadContractReferenceDiagnostic =
    duplicatePayloadContractReference?.diagnostics?.[0];
  if (
    duplicatePayloadContractReference?.ok !== false ||
    duplicatePayloadContractReferenceDiagnostic?.code !== "artifact/descriptor-payload" ||
    duplicatePayloadContractReferenceDiagnostic?.span == null ||
    duplicatePayloadContractReferenceDiagnostic.span.sourceId !==
      duplicatePayloadContractReferenceSourceId ||
    duplicatePayloadContractReferenceDiagnostic.span.startOffset !==
      duplicatePayloadContractReferenceSource.indexOf(
        "(define-duplicate-payload-contract-reference duplicate-payload-contract-reference)",
      ) ||
    !duplicatePayloadContractReferenceDiagnostic.message?.includes("DuplicatePayloadBase") ||
    !duplicatePayloadContractReferenceDiagnostic.message?.includes("repeat contract")
  ) {
    throw new Error(
      `Expected duplicate payload contract reference descriptor diagnostic:\n${JSON.stringify(
        duplicatePayloadContractReference,
        null,
        2,
      )}`,
    );
  }

  const conflictingInheritedPayloadContract = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: conflictingInheritedPayloadContractSourceId,
  });
  const conflictingInheritedPayloadContractDiagnostic =
    conflictingInheritedPayloadContract?.diagnostics?.[0];
  if (
    conflictingInheritedPayloadContract?.ok !== false ||
    conflictingInheritedPayloadContractDiagnostic?.code !== "artifact/descriptor-payload" ||
    conflictingInheritedPayloadContractDiagnostic?.span == null ||
    conflictingInheritedPayloadContractDiagnostic.span.sourceId !==
      conflictingInheritedPayloadContractSourceId ||
    conflictingInheritedPayloadContractDiagnostic.span.startOffset !==
      conflictingInheritedPayloadContractSource.indexOf(
        "(define-conflicting-inherited-payload-contract conflicting-inherited-payload-contract)",
      ) ||
    !conflictingInheritedPayloadContractDiagnostic.message?.includes("metadata") ||
    !conflictingInheritedPayloadContractDiagnostic.message?.includes("conflicting kind")
  ) {
    throw new Error(
      `Expected conflicting inherited payload contract descriptor diagnostic:\n${JSON.stringify(
        conflictingInheritedPayloadContract,
        null,
        2,
      )}`,
    );
  }

  const malformedPayloadContractAlias = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: malformedPayloadContractAliasSourceId,
  });
  const malformedPayloadContractAliasDiagnostic = malformedPayloadContractAlias?.diagnostics?.[0];
  if (
    malformedPayloadContractAlias?.ok !== false ||
    malformedPayloadContractAliasDiagnostic?.code !== "artifact/descriptor-payload" ||
    malformedPayloadContractAliasDiagnostic?.span == null ||
    malformedPayloadContractAliasDiagnostic.span.sourceId !==
      malformedPayloadContractAliasSourceId ||
    malformedPayloadContractAliasDiagnostic.span.startOffset !==
      malformedPayloadContractAliasSource.indexOf(
        "(define-malformed-payload-contract-alias malformed-payload-contract-alias)",
      ) ||
    !malformedPayloadContractAliasDiagnostic.message?.includes("MalformedPayloadContract") ||
    !malformedPayloadContractAliasDiagnostic.message?.includes(
      "payload clauses with textual clause names",
    )
  ) {
    throw new Error(
      `Expected malformed payload contract descriptor diagnostic:\n${JSON.stringify(
        malformedPayloadContractAlias,
        null,
        2,
      )}`,
    );
  }

  const unvalidatedHttpShape = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: unvalidatedHttpShapeSourceId,
  });
  expectOk("emit unvalidated HTTP-shaped payload", unvalidatedHttpShape);
  const unvalidatedHttpShapeContent = unvalidatedHttpShape.value?.artifacts?.[0]?.content;
  const unvalidatedHttpDeclaration = unvalidatedHttpShapeContent?.declarations?.[0];
  if (
    unvalidatedHttpShapeContent?.declarationCount !== 1 ||
    unvalidatedHttpDeclaration?.kind !== "Schema" ||
    unvalidatedHttpDeclaration?.schema?.kind !== "Ref" ||
    unvalidatedHttpDeclaration?.schema?.target !== "MissingSchema" ||
    unvalidatedHttpShapeContent?.declarationTypeSummaries?.[0]?.resultType !== "SchemaDecl"
  ) {
    throw new Error(
      `Expected HTTP-shaped payload without descriptor validator to emit as generic artifact:\n${JSON.stringify(
        unvalidatedHttpShape,
        null,
        2,
      )}`,
    );
  }

  const descriptorValidatedHttpShape = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: descriptorValidatedHttpShapeSourceId,
  });
  const descriptorValidatedHttpDiagnostic = descriptorValidatedHttpShape?.diagnostics?.[0];
  if (
    descriptorValidatedHttpShape?.ok !== false ||
    descriptorValidatedHttpDiagnostic?.code !== "http/unknown-schema-ref" ||
    descriptorValidatedHttpDiagnostic?.span == null ||
    descriptorValidatedHttpDiagnostic.span.sourceId !== descriptorValidatedHttpShapeSourceId ||
    descriptorValidatedHttpDiagnostic.span.startOffset !==
      descriptorValidatedHttpShapeSource.indexOf(
        "(define-descriptor-validated-http-schema descriptor-validated-http-schema)",
      ) ||
    descriptorValidatedHttpDiagnostic.span.endOffset <=
      descriptorValidatedHttpDiagnostic.span.startOffset ||
    !descriptorValidatedHttpDiagnostic.message?.includes("MissingSchema")
  ) {
    throw new Error(
      `Expected descriptor-selected HTTP validator diagnostic:\n${JSON.stringify(
        descriptorValidatedHttpShape,
        null,
        2,
      )}`,
    );
  }
} catch (error) {
  hardFailure = error;
} finally {
  if (sessionId) {
    try {
      await request({ op: "closeSession", sessionId });
    } catch {
      // The daemon may already be closing after an earlier hard failure.
    }
  }
  daemon.stdin.end();
}

const exitCode = await daemonExit;
if (exitCode !== 0) {
  throw new Error(`Daemon exited with ${exitCode}: ${stderr}`);
}

if (hardFailure) {
  console.error(`forma-ocaml emit check failed: ${hardFailure.message}`);
  process.exit(1);
}

console.log("forma-ocaml emit ok (canonical-ir)");
