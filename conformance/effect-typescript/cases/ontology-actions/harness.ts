import { Effect, Schema } from "effect";
import { DepartmentId, EmployeeId, OntologyRuntime, onboard, deactivate, remove } from "./expected.js";

export default async function run() {
  const employee = Schema.decodeUnknownSync(EmployeeId)("employee:ada");
  const department = Schema.decodeUnknownSync(DepartmentId)("department:engineering");
  const writes: unknown[] = [];
  const service = {
    createEmployee: (fields: { readonly name: string; readonly active: boolean }) => Effect.sync(() => { writes.push(["create", fields]); return employee; }),
    linkWorksAt: (from: EmployeeId, to: DepartmentId, fields: { readonly since: number }) => Effect.sync(() => { writes.push(["link", from, to, fields]); }),
    updateEmployee: (id: EmployeeId, fields: { readonly name?: string; readonly active?: boolean }) => Effect.sync(() => { writes.push(["update", id, fields]); }),
    retractEmployee: (id: EmployeeId) => Effect.sync(() => { writes.push(["retract", id]); }),
  };
  const result = await Effect.runPromise(onboard("Ada", department).pipe(Effect.provideService(OntologyRuntime, service)));
  const active = await Effect.runPromise(deactivate(result).pipe(Effect.provideService(OntologyRuntime, service)));
  await Effect.runPromise(remove(result).pipe(Effect.provideService(OntologyRuntime, service)));
  if (active !== true || JSON.stringify(writes) !== JSON.stringify([
    ["create", { name: "Ada", active: true }],
    ["link", employee, department, { since: 2026 }],
    ["update", employee, { active: false }],
    ["retract", employee],
  ])) throw new Error(`Unexpected ontology operations: ${JSON.stringify(writes)}`);
}
