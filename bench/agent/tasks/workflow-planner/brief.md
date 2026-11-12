# Design a workflow planning DSL
Build a small workflow language in `types.lisp`, `planner.lisp`, `forms.lisp`,
`main.lisp`. types exports Step {:id String :depends (List String) :timeout Int
:attempts Int :manual Bool} and Plan {:steps (List Step) :budget Int}.
planner exports cost : Plan -> Int, order : Plan -> List String, problems :
Plan -> List String. Cost is sum(timeout*attempts). order uses stable Kahn
scheduling: repeatedly select the FIRST remaining step whose dependencies have
ALL already been emitted; after each emission restart the scan from the first
remaining step. On deadlock return the schedulable prefix (never loop forever).
problems returns error categories ONCE each, in this order:
"ids" if any id is blank after trim or duplicated (compare original ids);
"dependencies" if any dependency is unknown, self, or duplicated within a step;
"settings" if any timeout/attempts <=0 or a manual step has attempts !=1;
"budget" if cost > budget or budget <0;
"cycle" if order cannot emit every step. Empty plans with budget zero are valid.
Do not confuse dependencies with original declaration order. Diamond graphs,
forward references, multiple roots, invalid settings and cycles are all tested.
forms exports workflow and WorkflowIR, syntax (workflow name :budget Int
:steps (List Step)), payload {:kind "Workflow" :name Symbol :cost Int
:order (List String)}. A :check uses planner's validation and returns exactly
one workflow/invalid diagnostic per invalid workflow at the :steps VALUE,
with category names in its message.
Use an Expr hole for :steps, with an inline structural List-of-record contract.
Valid workflows project cost and order.
main declares at least two workflows, one diamond in unsorted input order and
one empty plan. You may choose internal architecture and helper abstractions;
keep this public contract. Acceptance checks both evaluation and declaration IR.

Target: 20–60 minutes. Write the requested files in the sandbox root. Do not edit supplied context.
Use `forma check main.lisp`, `forma file evaluate main.lisp`, and (for forms)
`forma file declarations main.lisp`. Hidden tests import your public API, vary
inputs, and check diagnostics and source locations. Use only `.lisp` for Forma
source. No network or dependencies are needed.
