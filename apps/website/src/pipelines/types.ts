import type { PassName } from "@formalang/ts/engine";

export type StageKey = "source" | PassName | "target";
export type PipelineBadge = "live" | "preview";

export interface PipelineNarrationStep {
  readonly stage: StageKey;
  readonly span?: readonly [number, number] | undefined;
  readonly md: string;
}

export interface PipelinePreview {
  readonly targetLabel: string;
  readonly output: string;
  readonly language: "typescript" | "json";
  readonly notice?: string | undefined;
}

export interface PipelineVariant {
  readonly id: string;
  readonly label: string;
  readonly source: string;
  readonly stage?: StageKey | undefined;
  readonly description?: string | undefined;
}

export interface PipelineContext {
  readonly label: string;
  readonly code: string;
}

export interface PipelineDef {
  readonly id: string;
  readonly title: string;
  readonly tagline: string;
  readonly badge: PipelineBadge;
  readonly source: string;
  readonly passes: readonly PassName[];
  readonly context?: PipelineContext | undefined;
  readonly preview?: PipelinePreview | undefined;
  readonly variants?: readonly PipelineVariant[] | undefined;
  readonly narration: readonly PipelineNarrationStep[];
}

export const orderedStages: readonly StageKey[] = [
  "source",
  "parse",
  "expand",
  "typecheck",
  "evaluate",
  "target",
];

export const stageLabels: Record<StageKey, string> = {
  source: "Source",
  parse: "Read",
  expand: "Expand",
  typecheck: "Typecheck",
  evaluate: "Eval",
  target: "Target",
};
