import { resolveModuleGraph, sourceModuleResolver, relativeModuleId } from "../modules/graph.js";
import { moduleMechanicsDeclarations } from "../modules/link.js";
import { LanguageSession } from "../session/session.js";
import type { Diagnostic } from "../diagnostic/diagnostic.js";
import { diagnosticFromUnknown } from "../diagnostic/diagnostic.js";
import { bootstrapFromSources } from "../descriptor/bootstrap.js";
import { elaborateSources, sourceLocator } from "../descriptor/elaborate.js";
import { parse, toSExprMany } from "../reader/index.js";
import { mechanicsPackageableDeclarations } from "../mechanics/artifact.js";
import type { ArtifactValidatorRegistry } from "./validator-registry.js";
import { payloadContractsFromSources } from "./descriptor-contracts.js";
import { canonicalPayload, packageArtifact, validateDeclarations, type ArtifactPackage, type PackageableDeclaration } from "./artifact.js";

export interface EmitRequest {
  readonly session: LanguageSession;
  readonly source?: string;
  readonly sourceId?: string;
  readonly sourceIds?: readonly string[];
  readonly backend?: string;
  readonly engineName?: string;
  readonly engineVersion?: string;
  readonly validatorRegistry?: ArtifactValidatorRegistry;
}
export interface EmittedArtifact {
  readonly name: string;
  readonly mediaType: string;
  readonly content: ArtifactPackage;
}
export type EmitResult =
  | { readonly ok: true; readonly backend: "canonical-ir"; readonly artifactCount: number; readonly artifacts: readonly EmittedArtifact[]; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export function emitBackends() {
  return { defaultBackend: "canonical-ir", backends: [{ name: "canonical-ir", status: "implemented", artifactName: "ir.json", mediaType: "application/vnd.forma.ir+json", description: "Validated canonical JSON IR from session sources and descriptor preludes." }] } as const;
}

/** Explicit elaboration → validation → immutable packaging boundary. */
export function emit(request: EmitRequest): EmitResult {
  if (request.source !== undefined) {
    const { source, ...options } = request;
    const session = new LanguageSession({ id: request.session.id, env: request.session.env, projects: request.session.projects });
    for (const kind of ["prelude", "source"] as const) for (const input of request.session.orderedSources(kind)) {
      session.rememberSource({ id: input.id, text: input.text, kind });
    }
    const sourceId = request.sourceId ?? "request";
    session.rememberSource({ id: sourceId, text: source });
    return emit({ ...options, session, sourceId });
  }
  const sourceIds = request.sourceId ? [request.sourceId] : request.sourceIds ?? request.session.orderedSources("source").map(s => s.id).sort();
  const error = (code: string, message: string): EmitResult => ({ ok: false, diagnostics: [{ code, message, severity: "error", phase: "emit" }] });
  if (request.backend !== undefined && request.backend !== "canonical-ir") return error("abi/unsupported-backend", `Unsupported emit backend ${JSON.stringify(request.backend)}.`);
  for (const id of sourceIds) if (!request.session.source(id)) return error("abi/unknown-source", `Unknown loaded source ${JSON.stringify(id)}.`);
  try {
    const preludes = request.session.orderedSources("prelude").map(s => s.text);
    const contracts = payloadContractsFromSources(preludes);
    const sources = request.session.orderedSources("source").map(s => ({ sourceId: s.id, source: s.text }));
    const legacy = sources.map(({ source }) => toSExprMany(parse(source).redTree).filter(e => e._tag === "List" && e.items[0]?._tag === "Sym" && ["__form-descriptor", "__form-hook", "__payload-contract"].includes(e.items[0].name)).map(e => source.slice(e.loc.start, e.loc.end)).join("\n"));
    const prelude = bootstrapFromSources("", "", { additionalSources: [...preludes, ...legacy] });
    // Module directives belong to the module stage, even when a domain prelude
    // also declares a form with the same head (for example viewspec's `use`).
    // Mask their text while retaining offsets and lines for author diagnostics.
    const projectionSources = sources.map(({ sourceId, source }) => {
      const characters = source.split("");
      for (const expression of toSExprMany(parse(source).redTree)) {
        if (expression._tag !== "List" || expression.items[0]?._tag !== "Sym" ||
          !["use", "import", "export", "export-from"].includes(expression.items[0].name)) continue;
        for (let offset = expression.loc.start; offset < expression.loc.end; offset++) {
          if (characters[offset] !== "\n" && characters[offset] !== "\r") characters[offset] = " ";
        }
      }
      return { sourceId, source: characters.join("") };
    });
    const selected = new Set(sourceIds);
    const projected = elaborateSources(projectionSources, { prelude, payloadContracts: contracts, ...(request.validatorRegistry ? { validatorRegistry: request.validatorRegistry } : {}) });
    const originalForms = new Map(sources.map(s => [s.sourceId, toSExprMany(parse(s.source).redTree)]));
    // Module forms and typed mechanics are handled by their own stages.
    const diagnostics = projected.diagnostics.filter(d => d.code !== "elaborate/unknown-form" &&
      (!d.span || selected.has(d.span.sourceId) || d.code.startsWith("artifact/descriptor-") || d.code === "artifact/unknown-validator"));
    if (diagnostics.some(d => d.severity === "error")) return { ok: false, diagnostics };
    const declarations: PackageableDeclaration[] = projected.declarations.filter(d => selected.has(d.sourceId)).map(d => ({
      ...d,
      formIndex: originalForms.get(d.sourceId)!.findIndex(e => e.loc.start === d.span.startOffset),
    }));
    const mechanicsExpressions = (sourceId: string, source: string) => {
      const domain = projected.declarations.filter(d => d.sourceId === sourceId);
      return toSExprMany(parse(source).redTree).filter(e => {
        if (domain.some(d => d.span.startOffset === e.loc.start)) return false;
        if (e._tag === "List" && e.items[0]?._tag === "Sym" && ["define", ":"].includes(e.items[0].name) && e.items[1]?._tag === "Sym" && domain.some(d => d.summary.name === (e.items[1] as { name: string }).name)) return false;
        return true;
      });
    };
    const domainNames = new Map(sources.map(s => [s.sourceId, new Set(projected.declarations.filter(d => d.sourceId === s.sourceId).flatMap(d => d.summary.name ? [d.summary.name] : []))]));
    // Domain re-exports remain domain-owned through barrels as well.
    let changed = true;
    while (changed) {
      changed = false;
      for (const input of sources) for (const e of originalForms.get(input.sourceId)!) {
        if (e._tag !== "List" || e.items[0]?._tag !== "Sym" || e.items[0].name !== "export-from" || e.items[1]?._tag !== "Str" || e.items[2]?._tag !== "Vector") continue;
        const target = domainNames.get(relativeModuleId(e.items[1].value, input.sourceId));
        const local = domainNames.get(input.sourceId)!;
        for (const n of e.items[2].items) if (n._tag === "Sym" && target?.has(n.name) && !local.has(n.name)) { local.add(n.name); changed = true; }
      }
    }
    // Descriptor projection owns these forms and their exports. Resolve only
    // mechanics/kernel syntax here, preserving every author offset. The domain
    // declarations and original module manifest are packaged independently.
    const moduleSources = sources.map(s => {
      const kept = new Set(mechanicsExpressions(s.sourceId, s.source).map(e => e.loc.start));
      const characters = s.source.split("");
      const blank = (start: number, end: number) => {
        for (let i = start; i < end; i++) if (characters[i] !== "\n" && characters[i] !== "\r") characters[i] = " ";
      };
      for (const e of originalForms.get(s.sourceId)!) {
        const h = e._tag === "List" && e.items[0]?._tag === "Sym" ? e.items[0].name : undefined;
        if (!kept.has(e.loc.start) || h === "use") { blank(e.loc.start, e.loc.end); continue; }
        if (e._tag !== "List") continue;
        const target = e.items[1];
        const omitted = h === "export" ? domainNames.get(s.sourceId) :
          ["import", "export-from"].includes(h ?? "") && target?._tag === "Str" ? domainNames.get(relativeModuleId(target.value, s.sourceId)) : undefined;
        if (!omitted?.size) continue;
        const names = h === "export" ? e.items.slice(1) : e.items[2]?._tag === "Vector" ? e.items[2].items : [];
        if (h === "export" && names.every(n => n._tag === "Sym" && omitted.has(n.name))) {
          blank(e.loc.start, e.loc.end);
          continue;
        }
        for (const n of names) if (n._tag === "Sym" && omitted.has(n.name)) blank(n.loc.start, n.loc.end);
      }
      return {id: s.sourceId, source: characters.join("")};
    });
    const resolver = sourceModuleResolver(moduleSources);
    const hasDirectives = (id: string) => originalForms.get(id)?.some(e => e._tag === "List" && e.items[0]?._tag === "Sym" && ["import", "export", "export-from"].includes(e.items[0].name)) ?? false;
    const moduleClosure = (id: string, found = new Set<string>()): Set<string> => {
      if (found.has(id)) return found;
      found.add(id);
      for (const e of originalForms.get(id) ?? []) if (e._tag === "List" && e.items[0]?._tag === "Sym" && ["import", "export-from"].includes(e.items[0].name) && e.items[1]?._tag === "Str") moduleClosure(relativeModuleId(e.items[1].value, id), found);
      return found;
    };
    const hasMechanics = (id: string) => sources.some(s => s.sourceId === id && mechanicsExpressions(id, s.source).some(e => e._tag === "List" && e.items[0]?._tag === "Sym" &&
      ["type", "class", "error", "service", "layer", "__schema", "__error", "__class", "__service", "__layer", "__operation", ":"].includes(e.items[0].name)));
    const mechanicsContext: PackageableDeclaration[] = [];
    const seenModules = new Set<string>();
    const plainSources = sources.filter(s => !hasDirectives(s.sourceId));
    const context = plainSources.flatMap(s => mechanicsExpressions(s.sourceId, s.source));
    for (const id of sourceIds) {
      const closure = moduleClosure(id);
      if (hasDirectives(id) && [...closure].some(hasMechanics)) {
        const graph = resolveModuleGraph(moduleSources.find(s => s.id === id)!, resolver, {
          bindings: new Set(request.session.configurationEnv.bindingNames()), projects: request.session.projects,
        });
        for (const module of graph.modules) {
          const bindings: Record<string,string> = Object.fromEntries([...module.bindings.values(), ...module.imports.values()].map(b => [b.name, b.symbol]));
          for (const e of originalForms.get(module.id) ?? []) {
            if (e._tag !== "List" || e.items[0]?._tag !== "Sym" || e.items[0].name !== "import" || e.items[1]?._tag !== "Str" || e.items[2]?._tag !== "Sym" || e.items[2].name !== ":as" || e.items[3]?._tag !== "Sym") continue;
            const target = graph.modules.find(m => m.id === relativeModuleId((e.items[1] as {value:string}).value, module.id));
            for (const b of target?.interface.exports ?? []) bindings[`${e.items[3].name}/${b.name}`] = b.symbol;
          }
          for (let i = 0; i < declarations.length; i++) {
            const d = declarations[i]!;
            if (d.sourceId === module.id && projected.declarations.some(p => p.sourceId === d.sourceId && p.span.startOffset === d.span?.startOffset)) declarations[i] = {...d, resolvedBindings:bindings};
          }
        }
        const projectedModules = moduleMechanicsDeclarations(graph);
        if (projectedModules.diagnostics.some(d => d.severity === "error")) return {ok: false, diagnostics: projectedModules.diagnostics};
        for (const d of projectedModules.declarations) {
          const key = `${d.sourceId}:${d.formIndex}:${d.summary.name}`;
          if (seenModules.has(key)) continue;
          seenModules.add(key);
          const originals = originalForms.get(d.sourceId) ?? [];
          const formIndex = originals.findIndex(e => e.loc.start === d.span?.startOffset);
          const binding = [...(graph.modules.find(m => m.id === d.sourceId)?.bindings.values() ?? [])].find(b => b.symbol === d.summary.name);
          const declaration = {...d, ...(binding ? {authoredName:binding.name} : {}), formIndex: formIndex < 0 ? d.formIndex : formIndex,
            ...(formIndex < 0 ? {} : {span:sourceLocator(request.session.sourceText(d.sourceId)!, d.sourceId)(originals[formIndex]!.loc)}),
          };
          mechanicsContext.push(declaration);
          if (selected.has(d.sourceId)) declarations.push(declaration);
        }
        continue;
      }
      const source = request.session.sourceText(id)!;
      const parsed = parse(source);
      if (parsed.errors.length) return error("parse/syntax", parsed.errors[0]!.message);
      const mechanics = mechanicsPackageableDeclarations(mechanicsExpressions(id, source), id, false, context, { lowerOntology: false });
      if (!mechanics.ok) return { ok: false, diagnostics: mechanics.diagnostics.map(d => ({ ...d, severity: "error", phase: "emit" })) };
      const originals = originalForms.get(id)!;
      const locate = sourceLocator(source, id);
      declarations.push(...mechanics.declarations.map(d => {
        const formIndex = originals.findIndex(e => e.loc.start === d.span?.startOffset);
        return { ...d, formIndex, span: formIndex < 0 ? d.span : locate(originals[formIndex]!.loc) };
      }));
    }
    // Legacy non-module sources share a declaration scope. Project available
    // dependencies before selection, then retain only the transitive references
    // of the selected declarations; unrelated sources do not fail emitMany.
    const available: PackageableDeclaration[] = [];
    for (const input of plainSources.filter(s => !selected.has(s.sourceId))) {
      const result = mechanicsPackageableDeclarations(mechanicsExpressions(input.sourceId, input.source), input.sourceId, false, context, {lowerOntology:false});
      if (result.ok) available.push(...result.declarations);
    }
    const byName = new Map<string, PackageableDeclaration[]>();
    for (const d of available) if (d.summary.name) byName.set(d.summary.name, [...(byName.get(d.summary.name) ?? []), d]);
    const needed = new Set<PackageableDeclaration>();
    const visitReferences = (value: unknown, top = false): void => {
      if (typeof value === "string") {
        for (const d of byName.get(value) ?? byName.get(value.split(".")[0]!) ?? []) if (!needed.has(d)) { needed.add(d); visitReferences(d.payload, true); }
      } else if (Array.isArray(value)) value.forEach(child => visitReferences(child));
      else if (value && typeof value === "object") {
        const node = value as Record<string, unknown>;
        // Literal data and provenance never introduce declaration references.
        if (node["kind"] === "Literal" || node["kind"] === "Primitive") return;
        for (const [key, child] of Object.entries(node)) if (!["span", "kind", "method", "field", "key", "binding"].includes(key) && !(top && key === "name")) visitReferences(child);
      }
    };
    declarations.filter(d => !hasDirectives(d.sourceId)).forEach(d => visitReferences(d.payload, true));
    mechanicsContext.push(...needed);
    declarations.sort((a,b) => sourceIds.indexOf(a.sourceId) - sourceIds.indexOf(b.sourceId) || a.formIndex - b.formIndex);
    const validated = validateDeclarations(request.session, declarations, request.validatorRegistry, mechanicsContext.filter(d => !declarations.includes(d)));
    if (!validated.ok) return validated;
    const packaged = packageArtifact({ session: request.session, declarations: validated.declarations, sourceIds, engineName: request.engineName ?? "forma-typescript", engineVersion: request.engineVersion ?? "0.3.0" });
    if (!packaged.ok) return packaged;
    return { ok: true, backend: "canonical-ir", artifactCount: 1, artifacts: [{ name: "ir.json", mediaType: "application/vnd.forma.ir+json", content: packaged.artifact }], diagnostics: [] };
  } catch (error) {
    return { ok: false, diagnostics: [error && typeof error === "object" && "diagnostic" in error ? (error as {diagnostic: Diagnostic}).diagnostic : diagnosticFromUnknown(error, "emit", request.sourceId ?? "session")] };
  }
}

export function emitMany(request: EmitRequest) {
  const ids = request.sourceId ? [request.sourceId] : request.sourceIds ?? request.session.orderedSources("source").map(s => s.id).sort();
  const results = ids.map(sourceId => ({ sourceId, ...emit({ ...request, sourceId }) }));
  const emittedCount = results.filter(r => r.ok).length;
  const declarationCount = results.reduce((count, r) => count + (r.ok ? r.artifacts[0]!.content.declarationCount : 0), 0);
  return { ok: results.every(r => r.ok), backend: "canonical-ir" as const, sourceCount: results.length, emittedCount, succeededCount: emittedCount, declarationCount, results };
}

export function artifactSummary(request: EmitRequest) {
  const result = emit(request);
  if (!result.ok) return result;
  const content = result.artifacts[0]!.content;
  const counts = new Map<string, number>();
  for (const d of content.declarations) counts.set(d.summary.kind, (counts.get(d.summary.kind) ?? 0) + 1);
  return { ok: true as const, backend: "canonical-ir" as const, diagnosticCount: content.diagnostics.length, sourceCount: content.sources.length, declarationCount: content.declarationCount, kindCounts: Object.fromEntries([...counts].sort(([a],[b]) => a.localeCompare(b))), declarationsHash: content.declarationsHash, hashAlgorithm: content.hashAlgorithm, modules: content.modules, typeSummary: content.typeSummary, diagnostics: content.diagnostics };
}

/** Declaration/provenance projection compared with the stored canonical IR golden. */
export function canonicalIrProjection(artifact: ArtifactPackage) {
  return {
    declarationCount: artifact.declarationCount,
    declarations: artifact.declarations.map(d => canonicalPayload(d.payload)),
    declarationTypeSummaries: artifact.declarations.map(d => ({ kind: d.summary.kind, name: d.summary.name ?? null, resultType: d.summary.resultType })),
    declarationProvenance: artifact.declarations.map((d, declarationIndex) => ({ declarationIndex, sourceId: d.sourceId, formIndex: d.formIndex, span: d.span ? Object.fromEntries(Object.entries(d.span).filter(([k]) => k !== "sourceId")) : null })),
    modules: artifact.modules.map(({ sourceHash: _, ...m }) => m),
    typeSummary: artifact.typeSummary,
  };
}
