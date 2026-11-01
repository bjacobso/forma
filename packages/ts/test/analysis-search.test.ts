import { describe, expect, test } from "vitest";

import { Analysis } from "../src/index.js";

const PRELUDE = `(type StepIR {:kind "Step" :name String})
(type WaitIR {:kind "Wait" :event String})
(form (step name)
  "A unit of work performed by an external system."
  :types {:name String} :ir StepIR {:kind "Step" :name name})
(form (await-event event)
  "Pause until a webhook or other external event arrives."
  :types {:event String} :ir WaitIR {:kind "Wait" :event event})

;; Business days between two dates, skipping weekends.
(: business-days (-> Int Int Int))
(define business-days [from to] (- to from))

(define retry-limit "How many times a failed step is retried." 3)

;; ---------------------------------------------------------------
;; Not attached: a blank line separates this comment from the form.

(define unrelated 0)
`;

const search = (query: Analysis.SearchQuery, document = "") => {
  const workspace = new Analysis.AnalysisWorkspace();
  workspace.setPrelude("prelude.lisp", PRELUDE);
  workspace.setDocument("doc.lisp", document);
  return workspace.search(query);
};

describe("AnalysisWorkspace.search", () => {
  test("finds a form by words in its documentation", () => {
    const [best] = search({ text: "wait for webhook" });
    expect(best).toMatchObject({ name: "await-event", kind: "form", produces: "WaitIR", sourceId: "prelude.lisp" });
  });

  test("ranks name matches above documentation matches", () => {
    expect(search({ text: "step" }).map((result) => result.name)).toEqual(["step", "StepIR", "retry-limit"]);
  });

  test("reads comments above a definition and its signature, and docstrings", () => {
    expect(search({ text: "weekends" })[0]).toMatchObject({
      name: "business-days",
      doc: "Business days between two dates, skipping weekends.",
      type: "Int -> Int -> Int",
    });
    expect(search({ text: "retried" })[0]).toMatchObject({ name: "retry-limit", doc: "How many times a failed step is retried." });
    expect(search({ text: "attached" })).toEqual([]);
  });

  test("filters by produced IR type and by type name", () => {
    expect(search({ produces: "StepIR" }).map((result) => result.name)).toEqual(["step"]);
    expect(search({ type: "WaitIR" }).map((result) => result.name)).toEqual(["await-event"]);
  });

  test("includes definitions from documents", () => {
    expect(search({ text: "onboard" }, "(define onboard-employee 1)")[0]).toMatchObject({
      name: "onboard-employee",
      sourceId: "doc.lisp",
    });
  });
});
