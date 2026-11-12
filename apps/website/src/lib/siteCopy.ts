// Page descriptions shared by client-side document metadata and the worker
// that injects metadata into cold playground routes.

export const playgroundDescription =
  "Run Forma's compiler in your browser: domain keywords, inferred effect contracts, and generated targets, one pass at a time.";

export const galleryDescription =
  "Forma examples: domain keywords, effect contracts, and generated targets, then the checked core language underneath.";

/** Strips inline-code backticks so markdown-ish copy can be used as metadata. */
export function plainText(text: string): string {
  return text.replaceAll("`", "");
}
