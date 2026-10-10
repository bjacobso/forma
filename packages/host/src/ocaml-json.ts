/**
 * The frozen OCaml ABI prints integral Floats with string_of_float (`2.`),
 * which is not JSON number syntax. Repair numeric tokens at the transport
 * boundary without changing any value kinds or text inside JSON strings.
 */
export function parseOcamlJson(text: string): unknown {
  const json = text.replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|-?\b(?:nan|inf)\b/g, token => {
    if (token.startsWith('"')) return token;
    if (token === "nan" || token === "-nan") return '"NaN"';
    if (token === "inf") return '"Infinity"';
    if (token === "-inf") return '"-Infinity"';
    return token.replace(/\.(?=[eE]|$)/, ".0");
  });
  return JSON.parse(json);
}
