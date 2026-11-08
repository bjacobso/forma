// Direct maintenance: rename id and add label in types and value construction.
export type Query = { account_id: string; cursor: string; label: string };
export type UserFields = { account_id: { raw: string }; cursor: { raw: string }; label: { raw: string } };
export function wrap(q: Query): UserFields {
  return { account_id: { raw: q.account_id }, cursor: { raw: q.cursor }, label: { raw: q.label } };
}
