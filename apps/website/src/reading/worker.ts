/// <reference lib="webworker" />
/**
 * Analysis for the reading editor: one AnalysisWorkspace with the kernel,
 * RPC, and Cluster preludes, so prelude forms type and describe themselves.
 */
import { AnalysisWorkspace } from "@formalang/ts/analysis";
import { formSlots } from "@formalang/ts/editor";
import { expand } from "@formalang/ts/engine";
import { formatSExpr, formatSExprMany } from "@formalang/ts/formatter";
import { parse as read, toSExprMany } from "@formalang/ts/reader";
import { preludeSources } from "@formalang/ts/preludes";
import type { Analysis, Inspection, ReadingDiagnostic, ReadingRequest, ReadingResponse } from "./protocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const DOC = "reading.lisp";
const PRELUDES = ["kernel.lisp", "compiler.lisp", "rpc.lisp", "cluster.lisp"] as const;

const workspace = new AnalysisWorkspace();
for (const name of PRELUDES) workspace.setPrelude(`forma:${name}`, preludeSources[name]);

/** Kernel forms whose second element is the name they define. */
const DEFINING = new Set(["define", "type", "error", "service", "class", "macro", "typeclass", "instance", "layer", ":"]);

const descriptors = () => workspace.preludeScopes().scope.prelude?.descriptions.list() ?? [];

function analyze(source: string): Analysis {
  const started = performance.now();
  workspace.setDocument(DOC, source);
  const analysis = workspace.analysis(DOC);
  // Hole candidates: helpers the preludes define for themselves are not useful fills.
  const preludeOnly = new Set(workspace.symbols().definitions.filter(d => d.scope === "global" && d.sourceId !== DOC).map(d => d.name));
  for (const d of workspace.symbols().definitions) if (d.sourceId === DOC) preludeOnly.delete(d.name);
  const diagnostics = analysis.diagnostics.map((d): ReadingDiagnostic => {
    const details = (d.details ?? {}) as Record<string, unknown>;
    const from = d.span?.startOffset ?? 0;
    const candidates = Array.isArray(details.candidates) ? details.candidates.map(String).filter(name => !preludeOnly.has(name)).slice(0, 8) : undefined;
    return {
      from,
      to: Math.max(from, d.span?.endOffset ?? from),
      severity: d.severity === "warning" ? "warning" : d.severity === "error" ? "error" : "info",
      code: d.code,
      message: candidates && d.code === "typecheck/hole" ? d.message.replace(/; candidates: .*$/, "") : d.message,
      ...(d.help ? { help: d.help } : {}),
      ...(candidates ? { candidates } : {}),
      ...(typeof details.expected === "string" ? { expected: details.expected } : {}),
      ...(d.fix?.length ? { fix: d.fix.map(edit => ({ from: edit.span.startOffset, to: edit.span.endOffset, insert: edit.newText })) } : {}),
    };
  });
  return {
    source,
    typed: analysis.typedSpans.map(span => ({ from: span.start, to: span.end, type: span.type, tag: span.exprTag })),
    diagnostics,
    durationMs: performance.now() - started,
  };
}

async function inspect(source: string, from: number, to: number): Promise<Inspection> {
  workspace.setDocument(DOC, source);
  const all = descriptors();
  let form: Inspection["form"];
  const slots = formSlots({ source, offset: from, descriptors: all, descriptorSources: [] });
  if (slots && slots.form.span.start <= from && to <= slots.form.span.end) {
    const descriptor = all.find(candidate => candidate.name === slots.form.name);
    const holes = descriptor?.surface?.holes;
    form = {
      name: slots.form.name,
      ...(preludeOf(slots.form.name) ? { prelude: preludeOf(slots.form.name) } : {}),
      from: slots.form.span.start,
      to: slots.form.span.end,
      ...(slots.form.doc ? { doc: tidy(slots.form.doc) } : {}),
      ...(descriptor?.produces ? { produces: descriptor.produces } : {}),
      ...(slots.activeSlot ? { activeSlot: slots.activeSlot } : {}),
      identifiers: slots.identifiers.map(identifier => ({ name: identifier.name, ...(identifier.span ? { value: source.slice(identifier.span.start, identifier.span.end) } : {}) })),
      slots: slots.slots.map(slot => {
        const hole = holes?.get(slot.name);
        const type = slot.type ?? (hole ? formatSExpr(hole).trim() : undefined);
        return {
          name: slot.name,
          ...(type ? { type } : {}),
          ...(slot.doc ? { doc: slot.doc } : {}),
          required: slot.required,
          many: slot.many,
          missing: slot.missing,
          filled: !slot.empty,
          values: slot.occurrences.flatMap(occurrence => occurrence.values).map(value => ({ from: value.span.start, to: value.span.end, text: source.slice(value.span.start, value.span.end) })),
        };
      }),
    };
  }

  // The name at the selection, or the head of a selected list.
  const syntax = workspace.syntax(DOC);
  const at = syntax.at(from);
  // For a list, its head; for a definition such as (define older …), the name it defines.
  const children = at?.kind === "List" && at.span.start === from ? syntax.children(at.id).filter(child => child.kind !== "Comment") : [];
  const head = children[0] ? source.slice(children[0].span.start, children[0].span.end) : "";
  const defines = DEFINING.has(head) || all.some(descriptor => descriptor.name === head && descriptor.identifiers.some(identifier => identifier.declaration));
  const candidates = children.length ? children.slice(0, defines ? 2 : 1) : [at];
  let definition: Inspection["definition"];
  for (const node of candidates) {
    if (definition || node?.kind !== "Symbol") continue;
    const offset = node.span.start;
    const name = source.slice(node.span.start, node.span.end);
    const found = workspace.definition(DOC, offset);
    const references = workspace.references(DOC, offset).length;
    const type = workspace.analysis(DOC).bindingDisplay(name, offset);
    const formDescriptor = all.find(candidate => candidate.name === name);
    if (found) {
      definition = {
        name,
        kind: found.kind,
        form: found.form,
        local: found.scope === "local",
        ...(found.sourceId === DOC ? { from: found.span.start, to: found.span.end } : { elsewhere: found.sourceId.replace(/^forma:/, "") }),
        references,
        ...(type ? { type } : {}),
      };
    } else if (formDescriptor) {
      continue;
    } else if (type) {
      definition = { name, kind: "builtin", form: "builtin", local: false, elsewhere: "builtins", references, type };
    }
  }
  const expansion = from < to ? await expansionOf(source.slice(from, to)).catch(() => undefined) : undefined;
  return { ...(form ? { form } : {}), ...(definition ? { definition } : {}), ...(expansion ? { expansion } : {}) };
}

interface AstNode {
  readonly kind: string;
  readonly value?: unknown;
  readonly items?: readonly AstNode[];
  readonly entries?: readonly { readonly key: AstNode; readonly value: AstNode }[];
}

function printAst(node: AstNode): string {
  switch (node.kind) {
    case "list": return `(${(node.items ?? []).map(printAst).join(" ")})`;
    case "vector": return `[${(node.items ?? []).map(printAst).join(" ")}]`;
    case "map": return `{${(node.entries ?? []).map(entry => `${printAst(entry.key)} ${printAst(entry.value)}`).join(" ")}}`;
    case "string": return JSON.stringify(node.value);
    case "nil": return "nil";
    default: return String(node.value);
  }
}

/** The form after kernel macros run, when a macro changed it. */
async function expansionOf(text: string): Promise<string | undefined> {
  if (!text.startsWith("(")) return undefined;
  const result = await expand({ sourceId: "selection", source: text });
  if (result.diagnostics.some(d => d.severity === "error") || result.ast.length !== 1) return undefined;
  const expanded = printAst(result.ast[0] as AstNode);
  const normalize = (s: string) => s.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();
  if (normalize(expanded) === normalize(text)) return undefined;
  return formatSExprMany(toSExprMany(read(expanded).redTree)).trim();
}

/** Which bundled prelude declares a form. */
function preludeOf(name: string): string | undefined {
  return PRELUDES.find(prelude => preludeSources[prelude].includes(`(form (${name} `) || preludeSources[prelude].includes(`(form (${name})`));
}

/** Docstrings keep their source indentation; reflow them into paragraphs. */
function tidy(doc: string): string {
  return doc.split(/\n\s*\n/).map(paragraph => paragraph.replace(/\s*\n\s*/g, " ").trim()).join("\n\n");
}

ctx.onmessage = async (event: MessageEvent<ReadingRequest>) => {
  const request = event.data;
  let response: ReadingResponse;
  try {
    response = request.kind === "analyze"
      ? { id: request.id, kind: "analyze", analysis: analyze(request.source) }
      : { id: request.id, kind: "inspect", inspection: await inspect(request.source, request.from, request.to) };
  } catch (error) {
    response = { id: request.id, kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
  ctx.postMessage(response);
};

// Analyze the preludes now, so the first document check is fast.
workspace.preludeScopes();
