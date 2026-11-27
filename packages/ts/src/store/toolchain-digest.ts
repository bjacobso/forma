/**
 * Deterministic toolchain and input digests for RFC 0029 Stage 1 hash-keyed evidence.
 *
 * Browser-safe: contains no Node-only imports.
 */

import { engineVersion } from "../Engine.js";
import type { JsonValue } from "../artifact/artifact.js";
import { canonicalJson, sha256 } from "../artifact/canonical-json.js";
import {
  DEFAULT_LANGUAGE_PROFILE,
  type InputDigest,
  type ToolchainDigest,
} from "./types.js";

export type { InputDigest, ToolchainDigest } from "./types.js";

export const TOOLCHAIN_DIGEST_VERSION = "toolchain:v1" as const;
export const INPUT_DIGEST_VERSION = "input:v1" as const;
export const PRELUDE_DIGEST_VERSION = "prelude:v1" as const;
export const DEFAULT_TOOLCHAIN_LANGUAGE_PROFILE = DEFAULT_LANGUAGE_PROFILE;

/** Either a precomputed prelude digest or raw prelude source text to hash. */
export type PreludeDigestEntry =
  | { readonly id: string; readonly digest: string }
  | { readonly id: string; readonly source: string };

/**
 * Specification of the toolchain state that produced an evidence record.
 * Changing any component (checker/emitter version, language profile, prelude
 * digests, or compiler/emitter flags) produces a distinct `ToolchainDigest` and
 * invalidates cached evidence keyed on the previous digest.
 */
export interface ToolchainSpec {
  /** Version of the checker/kernel (defaults to `@formalang/ts` `engineVersion`). */
  readonly checkerVersion?: string | undefined;
  /** Version of the artifact emitter, when applicable (defaults to `checkerVersion`). */
  readonly emitterVersion?: string | undefined;
  /** Language profile identifier (defaults to `"forma-core-v1"`). */
  readonly languageProfile?: string | undefined;
  /**
   * Preludes in scope.
   * - An ordered array preserves load order (since prelude load order is semantic).
   * - A `Record<string, string>` or `ReadonlyMap<string, string>` maps prelude id
   *   to source text or digest and is sorted deterministically by id.
   */
  readonly preludes?:
    | readonly PreludeDigestEntry[]
    | Readonly<Record<string, string>>
    | ReadonlyMap<string, string>
    | undefined;
  /** Optional extra flags/profile parameters (e.g. target runtime, strictness). */
  readonly flags?: Readonly<Record<string, JsonValue>> | undefined;
}

/** Compute a deterministic content digest for a prelude source string. */
export function computePreludeDigest(source: string): string {
  return `${PRELUDE_DIGEST_VERSION}:${sha256(source)}`;
}

function normalizePreludes(
  preludes: ToolchainSpec["preludes"],
): readonly { readonly id: string; readonly digest: string }[] {
  if (preludes === undefined) return [];
  if (Array.isArray(preludes)) {
    return preludes.map((entry: PreludeDigestEntry) => ({
      id: entry.id,
      digest: "digest" in entry ? entry.digest : computePreludeDigest(entry.source),
    }));
  }
  if (preludes instanceof Map) {
    return [...preludes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, value]) => ({
        id,
        digest: value.startsWith(`${PRELUDE_DIGEST_VERSION}:`) ? value : computePreludeDigest(value),
      }));
  }
  return Object.entries(preludes as Readonly<Record<string, string>>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, value]) => ({
      id,
      digest: value.startsWith(`${PRELUDE_DIGEST_VERSION}:`) ? value : computePreludeDigest(value),
    }));
}

/**
 * Compute a deterministic `ToolchainDigest` from checker/emitter versions,
 * language profile, prelude digests, and optional flags.
 */
export function computeToolchainDigest(spec: ToolchainSpec = {}): ToolchainDigest {
  const checkerVersion = spec.checkerVersion ?? engineVersion;
  const emitterVersion = spec.emitterVersion ?? checkerVersion;
  const languageProfile = spec.languageProfile ?? DEFAULT_TOOLCHAIN_LANGUAGE_PROFILE;
  const preludes = normalizePreludes(spec.preludes);
  const payload: JsonValue = {
    version: TOOLCHAIN_DIGEST_VERSION,
    checkerVersion,
    emitterVersion,
    languageProfile,
    preludes: preludes.map((p) => ({ id: p.id, digest: p.digest })),
    ...(spec.flags !== undefined ? { flags: spec.flags } : {}),
  };
  return `${TOOLCHAIN_DIGEST_VERSION}:${sha256(canonicalJson(payload))}`;
}

/**
 * Compute a deterministic `InputDigest` for additional computation inputs
 * (e.g. emitter target options, runner profile parameters, verification bounds).
 * Object key insertion order does not affect the digest.
 */
export function computeInputDigest(input?: JsonValue): InputDigest {
  const normalized: JsonValue = input === undefined ? null : input;
  return `${INPUT_DIGEST_VERSION}:${sha256(canonicalJson(normalized))}`;
}

/** Default `ToolchainSpec` for HM/Effect typechecking with the current engine version. */
export function defaultTypecheckToolchain(
  overrides: Omit<ToolchainSpec, "checkerVersion"> & { readonly checkerVersion?: string | undefined } = {},
): ToolchainDigest {
  return computeToolchainDigest({
    checkerVersion: overrides.checkerVersion ?? engineVersion,
    ...overrides,
  });
}

/** Default `ToolchainSpec` for artifact emission (canonical IR or Effect TypeScript). */
export function defaultArtifactToolchain(
  format: "canonical-ir" | "effect-ts",
  overrides: ToolchainSpec = {},
): ToolchainDigest {
  return computeToolchainDigest({
    ...overrides,
    flags: {
      ...(overrides.flags ?? {}),
      artifactFormat: format,
    },
  });
}
