// Directly written by the implementing LLM, without the generator.
export type Query = { id: string; cursor: string };
export type UserFields = { id: { raw: string }; cursor: { raw: string } };
export function wrap(q: Query): UserFields {
  return { id: { raw: q.id }, cursor: { raw: q.cursor } };
}
