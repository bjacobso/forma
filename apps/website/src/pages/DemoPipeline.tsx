import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { DiagnosticList } from "../components/DiagnosticList";
import { ExpandDiff } from "../components/ExpandDiff";
import { NarrationCard } from "../components/NarrationCard";
import { ShareButton } from "../components/ShareButton";
import { SourcePane } from "../components/SourcePane";
import { SExprTree } from "../components/SExprTree";
import { StageRail } from "../components/StageRail";
import { TargetPane } from "../components/TargetPane";
import { TypePanel } from "../components/TypePanel";
import { ValueView } from "../components/ValueView";
import { EngineClient } from "../engine/client";
import type { RunResult, TimedPassResult } from "../engine/protocol";
import { hasErrors } from "../engine/protocol";
import {
  astToSource,
  collectAstSpans,
  passOf,
  sameSpan,
  spanContainsRange,
  spanRange,
  spanSize,
  uniqueSpans,
  type SpanRange,
} from "../lib/artifacts";
import { InlineCodeText } from "../components/Dfn";
import { useDocumentMeta } from "../lib/documentMeta";
import { plainText } from "../lib/siteCopy";
import { readDemoUrlState, writeDemoUrlState } from "../lib/urlState";
import { getPipeline, pipelines } from "../pipelines";
import {
  pipelineGroups,
  stageLabels,
  type PipelineDef,
  type PipelineVariant,
  type StageKey,
} from "../pipelines/types";

export function DemoPipeline() {
  const { pipelineId } = useParams();
  const [search] = useSearchParams();
  const pipeline = getPipeline(pipelineId);
  const embed = search.get("embed") === "1";
  const initialUrl = useMemo(() => readDemoUrlState(search), [search]);
  useDocumentMeta({
    title: `${pipeline.title} - Forma`,
    description: plainText(pipeline.tagline),
  });
  const [source, setSource] = useState(initialUrl.source ?? pipeline.source);
  const [selectedStage, setSelectedStage] = useState<StageKey>(
    initialUrl.step !== null
      ? (pipeline.narration[initialUrl.step]?.stage ?? "source")
      : "source",
  );
  const [selectedSpan, setSelectedSpan] = useState<SpanRange | null>(
    initialUrl.selectedOffset === null ? null : [initialUrl.selectedOffset, initialUrl.selectedOffset],
  );
  const [tourStep, setTourStep] = useState<number | null>(initialTourStep(initialUrl));
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runStatus, setRunStatus] = useState<"idle" | "running" | "error">("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const clientRef = useRef<EngineClient | null>(null);
  const runToken = useRef(0);

  useEffect(() => {
    setSource(initialUrl.source ?? pipeline.source);
    const nextStep = initialTourStep(initialUrl);
    setTourStep(nextStep);
    setSelectedStage(nextStep === null ? "source" : (pipeline.narration[nextStep]?.stage ?? "source"));
    setSelectedSpan(
      initialUrl.selectedOffset === null ? null : [initialUrl.selectedOffset, initialUrl.selectedOffset],
    );
  }, [pipeline.id]);

  useEffect(() => {
    clientRef.current ??= new EngineClient();
    const token = ++runToken.current;
    setRunStatus("running");
    setRunError(null);
    setRunResult(null);
    const timeout = window.setTimeout(() => {
      clientRef.current
        ?.run(source, pipeline.passes, pipeline.id)
        .then((result) => {
          if (token !== runToken.current) return;
          setRunResult(result);
          setRunStatus("idle");
        })
        .catch((error: Error) => {
          if (token !== runToken.current) return;
          setRunResult(null);
          setRunStatus("error");
          setRunError(error.message);
        });
    }, 300);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [pipeline.id, pipeline.passes, source]);

  useEffect(() => {
    return () => clientRef.current?.dispose();
  }, []);

  useEffect(() => {
    writeDemoUrlState(window.location.pathname, {
      step: tourStep,
      source,
      presetSource: pipeline.source,
      selectedStage,
      selectedOffset: selectedSpan?.[0] ?? null,
      embed,
    });
  }, [embed, pipeline.id, pipeline.source, selectedSpan, selectedStage, source, tourStep]);

  useEffect(() => {
    if (tourStep === null) return;
    const item = pipeline.narration[tourStep];
    if (!item) return;
    setSelectedStage(item.stage);
    setSelectedSpan(item.span ?? null);
  }, [pipeline, tourStep]);

  const results = runResult?.passResults ?? [];
  const parseResult = passOf(results, "parse");
  const expandResult = passOf(results, "expand");
  const typecheckResult = passOf(results, "typecheck");
  const evaluateResult = passOf(results, "evaluate");
  const activeStages: StageKey[] = ["source", ...pipeline.passes, ...(pipeline.preview || pipeline.target ? ["target" as const] : [])];
  const pipelineIndex = pipelines.findIndex((item) => item.id === pipeline.id);
  const selectableSpans = useMemo(
    () =>
      uniqueSpans([
        ...collectAstSpans(parseResult?.ast),
        ...(typecheckResult?.expressionTypes ?? []).map((item) => spanRange(item.span)),
      ]),
    [parseResult, typecheckResult],
  );
  const selectedInspection = useMemo(
    () => inspectSelectedSpan(source, selectedSpan, typecheckResult),
    [source, selectedSpan, typecheckResult],
  );
  const selectedResult =
    selectedStage === "parse"
      ? parseResult
      : selectedStage === "expand"
        ? expandResult
        : selectedStage === "typecheck"
          ? typecheckResult
          : selectedStage === "evaluate"
            ? evaluateResult
            : null;

  return (
    <main className={embed ? "demo-page demo-page-embed" : "demo-page"}>
      {!embed ? (
        <header className="demo-header">
          <div>
            <nav className="breadcrumbs" aria-label="Breadcrumb">
              <a href="/">Home</a><span>/</span><Link to="/demo">Examples</Link><span>/</span><span>{pipeline.title}</span>
            </nav>
            <span className="eyebrow">{groupEyebrow(pipeline)}</span>
            <h1>{pipeline.title}</h1>
            <p><InlineCodeText text={pipeline.tagline} /></p>
          </div>
          <div className="demo-toolbar">
            <span className={`badge ${pipeline.badge === "live" ? "badge-live" : "badge-preview"}`}>
              {pipeline.badge.toUpperCase()}
            </span>
            {pipeline.variants ? (
              <SourceVariantSwitch
                onSelect={(variant) => {
                  setSource(variant.source);
                  setSelectedStage(variant.stage ?? "source");
                  setSelectedSpan(null);
                  setTourStep(null);
                }}
                source={source}
                variants={pipeline.variants}
              />
            ) : null}
            <button
              className="icon-button"
              onClick={() => {
                setSource(pipeline.source);
                setSelectedSpan(null);
                setTourStep(0);
              }}
              title="Reset source"
              type="button"
            >
              <RotateCcw size={17} />
              <span>Reset</span>
            </button>
            <ShareButton />
          </div>
        </header>
      ) : (
        <header className="embed-header">
          <div>
            <span className="eyebrow">Forma</span>
            <h1>{pipeline.title}</h1>
          </div>
          <span className={`badge ${pipeline.badge === "live" ? "badge-live" : "badge-preview"}`}>
            {pipeline.badge.toUpperCase()}
          </span>
        </header>
      )}

      {!embed ? (
        <nav className="example-navigation" aria-label="Example navigation">
          <Link to="/demo">← All examples</Link>
          <div>
            {pipelineIndex > 0 ? <Link to={`/demo/${pipelines[pipelineIndex - 1]!.id}`}>← Previous</Link> : null}
            {pipelineIndex < pipelines.length - 1 ? <Link to={`/demo/${pipelines[pipelineIndex + 1]!.id}`}>Next example →</Link> : null}
          </div>
        </nav>
      ) : null}

      <StageRail
        activeStages={activeStages}
        onSelect={(stage) => {
          setSelectedStage(stage);
          setTourStep(null);
        }}
        results={results}
        selectedStage={selectedStage}
        stoppedAt={runResult?.stoppedAt}
      />

      <section className="demo-workbench">
        <div className="pane pane-input">
          <div className="pane-heading">
            <span>{selectedStage === "source" ? "Edit source" : "Input"}</span>
            {runStatus === "running" ? <code>running</code> : null}
          </div>
          {renderInputPane(selectedStage, source, parseResult, expandResult)}
        </div>
        <div className="pass-arrow">
          <span>{stageLabels[selectedStage]}</span>
          {selectedResult ? <small>{Math.round(selectedResult.durationMs)}ms</small> : null}
        </div>
        <div className="pane pane-output">
          <div className="pane-heading">
            <span>Output</span>
            {selectedResult && hasErrors(selectedResult) ? <code>diagnostics</code> : null}
          </div>
          {runStatus === "error" ? (
            <article className="diagnostic diagnostic-error">
              <p>{runError}</p>
            </article>
          ) : (
            renderOutputPane({
              selectedStage,
              source,
              setSource,
              parseResult,
              expandResult,
              typecheckResult,
              evaluateResult,
              preview: pipeline.preview,
              target: pipeline.target,
              context: pipeline.context,
              selectedSpan,
              selectedInspection,
              selectableSpans,
              setSelectedSpan,
            })
          )}
        </div>
      </section>

      {selectedResult ? <DiagnosticList diagnostics={selectedResult.diagnostics} /> : null}

      {!embed ? (
        <NarrationCard
          onClose={() => setTourStep(null)}
          onStep={setTourStep}
          pipeline={pipeline}
          step={tourStep}
        />
      ) : null}
    </main>
  );
}

function groupEyebrow(pipeline: PipelineDef): string {
  const group = pipelineGroups.find((item) => item.id === pipeline.group);
  const position = pipelines.filter((item) => item.group === pipeline.group).indexOf(pipeline) + 1;
  return `${group?.label ?? "Example"} / ${String(position).padStart(2, "0")}`;
}

function initialTourStep(initialUrl: ReturnType<typeof readDemoUrlState>): number | null {
  if (initialUrl.step === null && initialUrl.selectedOffset !== null) return null;
  return initialUrl.step ?? 0;
}

function SourceVariantSwitch({
  variants,
  source,
  onSelect,
}: {
  readonly variants: readonly PipelineVariant[];
  readonly source: string;
  readonly onSelect: (variant: PipelineVariant) => void;
}) {
  return (
    <div className="variant-switcher" aria-label="Source variants">
      {variants.map((variant) => (
        <button
          aria-pressed={variant.source === source}
          className={variant.source === source ? "variant-button variant-button-active" : "variant-button"}
          key={variant.id}
          onClick={() => onSelect(variant)}
          title={variant.description}
          type="button"
        >
          {variant.label}
        </button>
      ))}
    </div>
  );
}

function renderInputPane(
  stage: StageKey,
  source: string,
  parseResult: Extract<TimedPassResult, { readonly pass: "parse" }> | null,
  expandResult: Extract<TimedPassResult, { readonly pass: "expand" }> | null,
) {
  if (stage === "source") return (
    <div className="source-intro">
      <span className="eyebrow">01 / START WITH SOURCE</span>
      <h2>Make one change. Follow it through.</h2>
      <p>Edit the program in the pane on the right. Forma reruns the available compiler passes as you type.</p>
      <ol>
        <li>Choose a stage above to inspect its output.</li>
        <li>Click an expression to trace it back to source.</li>
        <li>Use the tour to follow the example step by step.</li>
      </ol>
    </div>
  );
  if (stage === "parse") return <pre>{source}</pre>;
  if (stage === "expand") return <pre>{astToSource(parseResult?.ast)}</pre>;
  if (stage === "typecheck" || stage === "evaluate" || stage === "target") {
    return <pre>{astToSource(expandResult?.ast ?? parseResult?.ast)}</pre>;
  }
  return <pre>{source}</pre>;
}

function renderOutputPane({
  selectedStage,
  source,
  setSource,
  parseResult,
  expandResult,
  typecheckResult,
  evaluateResult,
  preview,
  target,
  context,
  selectedSpan,
  selectedInspection,
  selectableSpans,
  setSelectedSpan,
}: {
  readonly selectedStage: StageKey;
  readonly source: string;
  readonly setSource: (source: string) => void;
  readonly parseResult: Extract<TimedPassResult, { readonly pass: "parse" }> | null;
  readonly expandResult: Extract<TimedPassResult, { readonly pass: "expand" }> | null;
  readonly typecheckResult: Extract<TimedPassResult, { readonly pass: "typecheck" }> | null;
  readonly evaluateResult: Extract<TimedPassResult, { readonly pass: "evaluate" }> | null;
  readonly preview: ReturnType<typeof getPipeline>["preview"];
  readonly target: ReturnType<typeof getPipeline>["target"];
  readonly context: ReturnType<typeof getPipeline>["context"];
  readonly selectedSpan: SpanRange | null;
  readonly selectedInspection: SelectedInspection | null;
  readonly selectableSpans: readonly SpanRange[];
  readonly setSelectedSpan: (span: SpanRange | null) => void;
}) {
  switch (selectedStage) {
    case "source":
      return (
        <SourcePane
          onChange={setSource}
          onSelectSpan={setSelectedSpan}
          selectableSpans={selectableSpans}
          context={context}
          selectedExcerpt={selectedInspection?.excerpt}
          selectedSpan={selectedSpan}
          selectedType={selectedInspection?.type}
          source={source}
        />
      );
    case "parse":
      return (
        <SExprTree
          ast={parseResult?.ast ?? []}
          onSelectSpan={setSelectedSpan}
          selectedSpan={selectedSpan}
        />
      );
    case "expand":
      return (
        <ExpandDiff
          expandResult={expandResult}
          onSelectSpan={setSelectedSpan}
          parseResult={parseResult}
          selectedSpan={selectedSpan}
        />
      );
    case "typecheck":
      return (
        <TypePanel
          onSelectSpan={setSelectedSpan}
          result={typecheckResult}
          selectedSpan={selectedSpan}
        />
      );
    case "evaluate":
      return <ValueView result={evaluateResult} />;
    case "target":
      return <TargetPane preview={preview} target={target} evaluation={evaluateResult} />;
  }
}

interface SelectedInspection {
  readonly excerpt: string;
  readonly type?: string | undefined;
}

function inspectSelectedSpan(
  source: string,
  selectedSpan: SpanRange | null,
  typecheckResult: Extract<TimedPassResult, { readonly pass: "typecheck" }> | null,
): SelectedInspection | null {
  if (!selectedSpan) return null;
  const typed = bestTypedExpression(selectedSpan, typecheckResult);
  const span = typed ? spanRange(typed.span) : selectedSpan;
  if (!span) return null;
  const excerpt = source.slice(span[0], span[1]).replace(/\s+/g, " ").trim();
  if (!excerpt) return null;
  return {
    excerpt,
    ...(typed ? { type: typed.display } : {}),
  };
}

function bestTypedExpression(
  selectedSpan: SpanRange,
  typecheckResult: Extract<TimedPassResult, { readonly pass: "typecheck" }> | null,
) {
  const expressionTypes = typecheckResult?.expressionTypes ?? [];
  const exact = expressionTypes.find((item) => sameSpan(spanRange(item.span), selectedSpan));
  if (exact) return exact;
  return expressionTypes
    .filter((item) => spanContainsRange(spanRange(item.span), selectedSpan))
    .sort((a, b) => spanSize(spanRange(a.span) ?? [0, Number.MAX_SAFE_INTEGER]) - spanSize(spanRange(b.span) ?? [0, Number.MAX_SAFE_INTEGER]))[0];
}
