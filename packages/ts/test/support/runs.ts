/**
 * Property-test run counts. CI uses the counts written in the tests; set
 * `FORMA_PROPERTY_SCALE` (for example `FORMA_PROPERTY_SCALE=20`) to multiply
 * them for a longer local run.
 */
export const runs = (count: number): number =>
  Math.max(1, Math.round(count * Number(process.env["FORMA_PROPERTY_SCALE"] ?? "1")));
