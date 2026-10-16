const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function normalizeSpan(span, sourceId) {
  if (!isObject(span)) return undefined;
  return {
    sourceId: span.sourceId ?? sourceId,
    startOffset: span.startOffset,
    endOffset: span.endOffset,
  };
}

export function normalizeDiagnostic(diagnostic) {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    phase: diagnostic.phase,
    ...(diagnostic.span ? { span: normalizeSpan(diagnostic.span) } : {}),
  };
}

export function normalizeAst(result) {
  return {
    ast: normalizePayload(result.ast),
    diagnostics: result.diagnostics.map(normalizeDiagnostic),
  };
}

export function normalizeTypecheck(result) {
  const display = result.display ?? result.type?.display;
  return {
    ...(display === undefined ? {} : { type: display }),
    diagnostics: result.diagnostics.map(normalizeDiagnostic),
  };
}

export function normalizeValue(value) {
  if (!isObject(value)) return value;
  switch (value.kind) {
    case "list":
    case "vector":
      return { kind: value.kind, items: value.items.map(normalizeValue) };
    case "map":
      return {
        kind: "map",
        entries: value.entries
          .map(({ key, value: entryValue }) => ({
            key: normalizeValue(key),
            value: normalizeValue(entryValue),
          }))
          .sort((left, right) => JSON.stringify(left.key).localeCompare(JSON.stringify(right.key))),
      };
    default:
      return {
        kind: value.kind,
        ...(Object.hasOwn(value, "value") ? { value: value.value } : {}),
        ...(value.tag ? { tag: value.tag } : {}),
      };
  }
}

export function normalizeEvaluate(result) {
  return {
    value: normalizeValue(result.value),
    diagnostics: result.diagnostics.map(normalizeDiagnostic),
  };
}

export function normalizePayload(value) {
  if (Array.isArray(value)) return value.map(normalizePayload);
  if (!isObject(value)) return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === "$summary") continue;
    output[key] = key === "span" ? normalizeSpan(nested) : normalizePayload(nested);
  }
  return output;
}

const declarationKey = (declaration) =>
  `${declaration.payload.kind}:${declaration.payload.name}:${declaration.formIndex}`;

export function normalizeTsDeclarations(declarations) {
  return declarations
    .map((declaration) => ({
      sourceId: declaration.sourceId,
      formIndex: declaration.formIndex,
      span: normalizeSpan(declaration.span, declaration.sourceId),
      payload: normalizePayload(declaration.payload),
    }))
    .sort((left, right) => declarationKey(left).localeCompare(declarationKey(right)));
}

const missing = { missing: true };
const pointerSegment = (value) => String(value).replaceAll("~", "~0").replaceAll("/", "~1");

export function diffValues(actual, expected, limit = 100) {
  const differences = [];
  const walk = (left, right, path) => {
    if (differences.length >= limit || Object.is(left, right)) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      for (let index = 0; index < Math.max(left.length, right.length); index++) {
        walk(index < left.length ? left[index] : missing, index < right.length ? right[index] : missing, `${path}/${index}`);
      }
      return;
    }
    if (isObject(left) && isObject(right)) {
      for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
        walk(Object.hasOwn(left, key) ? left[key] : missing, Object.hasOwn(right, key) ? right[key] : missing, `${path}/${pointerSegment(key)}`);
      }
      return;
    }
    differences.push({ path: path || "$", actual: left, expected: right });
  };
  walk(actual, expected, "");
  return differences;
}
