import {
  bootstrapFromSources,
  elaborateProgram,
} from "@formalang/ts/descriptor";
import { generateEffectProgram } from "@formalang/ts/mechanics";
import { preludeSource } from "@formalang/ts/preludes";
import { encodePreludeDemo } from "./lib/preludeShare";
import {
  contractSource,
  entitySchemaSource,
  undeclaredCapabilitySource,
} from "./pipelines/sources";
import { typingEdit } from "./workbench/examples";

const releasePrelude = `(type Action (Union "process.test" "human.approve"))

(type StepIR {:kind "Step" :name Symbol :action Action})
(form (step name action)
  :types {:name (Declares Step) :action Action}
  :ir StepIR
  {:kind "Step" :name name :action action})

(type WorkflowIR {:kind "Workflow" :name Symbol :steps (List StepIR)})
(form (workflow name step ...)
  :types {:name (Declares Workflow) :step (List step)}
  :ir WorkflowIR
  {:kind "Workflow" :name name :steps step})`;

const releaseSource = `(workflow release
  (step verify "process.test")
  (step approve "human.approve"))`;

/** Recorded compiler results for the scripted hero, regenerated with the other home snippets. */
export function homeHeroStories() {
  const ontology = preludeSource("ontology.lisp");
  const queryForm = ontology
    .slice(
      ontology.indexOf("(form (query name"),
      ontology.indexOf("; Domain projections"),
    )
    .trim();
  const stories = [
    {
      id: "release",
      label: "Release plan",
      sourceId: "release.forma",
      title: "Give a plan its own vocabulary.",
      introduction:
        "A tiny custom prelude defines workflow, step and a closed set of actions.",
      preludeLabel: "release.prelude.forma · excerpt",
      preludeExcerpt: `(type Action
  (Union "process.test" "human.approve"))

(form (step name action)
  :types {:name (Declares Step) :action Action}
  :ir StepIR …)`,
      prelude: releasePrelude,
      source: releaseSource,
      broken: releaseSource.replace("process.test", "process.tset"),
      repairText: "Change process.tset to the allowed action process.test.",
      outcome: "A checked release plan, ready for your tooling.",
      consumer:
        "Your application gives these steps meaning. Forma has not run tests, requested approval or scheduled a workflow.",
      outputLabel: "Workflow IR",
      linkLabel: "Edit this language live",
      href: `/playground/custom${encodePreludeDemo({ title: "A checked release plan", prelude: releasePrelude, source: releaseSource })}`,
    },
    {
      id: "query",
      label: "Schema & query",
      sourceId: "schema.forma",
      title: "Let a schema shape its query language.",
      introduction:
        "The ontology prelude introduces entity fields into a query’s scope and requires a Bool predicate.",
      preludeLabel: "ontology.lisp · query excerpt",
      preludeExcerpt: `(form (query name {:keys [from where select]})
  :types {… :from (Refers SchemaDecl)
    :where (Option (Expr Bool)) …}
  :scope {:where
    (fn [{:keys [from]}] (entity-fields from))}
  :ir QueryIR …)`,
      prelude: queryForm,
      source: entitySchemaSource.trim(),
      broken: entitySchemaSource.trim().replace(":where active", ":where name"),
      repairText: "Use active, a Bool field, instead of name, a String field.",
      outcome: "A checked query with qualified field names.",
      consumer:
        "Your application interprets the Query IR. This story does not execute SQL, contact a database or return employee records.",
      outputLabel: "Query IR",
      linkLabel: "Inspect the stored entity example",
      href: "/playground/demo/entities",
    },
    {
      id: "effect",
      label: "Effect contract",
      sourceId: "log.forma",
      title: "Make a service requirement explicit.",
      introduction:
        "The supported Effect language tracks the failures and service requirements of an operation.",
      preludeLabel: "Effect vocabulary · program excerpt",
      preludeExcerpt: `(error ConsoleUnavailable {:message String})

(service Console
  (: print
    (-> String
      (Effect Unit [ConsoleUnavailable] []))))`,
      prelude: "",
      source: contractSource,
      broken: undeclaredCapabilitySource,
      repairText:
        "Add Console.print to log’s declared requirements. The error points at the call that needs it.",
      outcome: "Checked Effect TypeScript, not a promise of every target.",
      consumer:
        "The generated function uses a Console service. Your host supplies its implementation and authorization; this story does not execute it.",
      outputLabel: "Effect TypeScript · excerpt",
      linkLabel: "Edit this Effect program live",
      href: "/playground/live/contracts",
    },
  ];

  return stories.map((story) => {
    const compile = (source: string) => {
      if (story.id === "effect") {
        const result = generateEffectProgram(source, {
          sourceId: story.sourceId,
        });
        return { diagnostics: result.diagnostics, output: result.code ?? "" };
      }
      const prelude =
        story.id === "query"
          ? bootstrapFromSources(preludeSource("compiler.lisp"), ontology)
          : bootstrapFromSources("", releasePrelude);
      const result = elaborateProgram(source, {
        prelude,
        sourceId: story.sourceId,
      });
      const payloads = result.declarations
        .filter(
          (declaration) =>
            story.id !== "query" || declaration.formName === "query",
        )
        .map((declaration) => declaration.payload);
      return {
        diagnostics: result.diagnostics,
        output: JSON.stringify(payloads, null, 2),
      };
    };
    const good = compile(story.source);
    const bad = compile(story.broken);
    const diagnostic = bad.diagnostics[0];
    if (
      good.diagnostics.length ||
      !good.output ||
      bad.diagnostics.length !== 1 ||
      !diagnostic?.span ||
      diagnostic.severity !== "error"
    ) {
      throw new Error(
        `Hero story ${story.id} must have one located error and a clean repaired output: ${JSON.stringify({ good, bad })}`,
      );
    }
    const outputExcerpt =
      story.id === "effect"
        ? good.output.slice(good.output.indexOf("export const log"))
        : good.output;
    return {
      ...story,
      diagnostic,
      edit: typingEdit(story.source, story.broken),
      output: good.output,
      outputExcerpt,
    };
  });
}
