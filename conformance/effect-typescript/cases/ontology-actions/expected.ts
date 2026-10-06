import { Context, Effect, Schema } from "effect";

export const EmployeeId = Schema.String.pipe(Schema.brand("Employee.Id"));
export type EmployeeId = typeof EmployeeId.Type;

export const Employee = Schema.Struct({
  id: EmployeeId,
  name: Schema.String,
  active: Schema.Boolean,
});
export type Employee = typeof Employee.Type;

export const DepartmentId = Schema.String.pipe(Schema.brand("Department.Id"));
export type DepartmentId = typeof DepartmentId.Type;

export const Department = Schema.Struct({
  id: DepartmentId,
  name: Schema.String,
});
export type Department = typeof Department.Type;

export class OntologyRuntime extends Context.Service<
  OntologyRuntime,
  {
    readonly createEmployee: (arg0: { readonly name: string; readonly active: boolean }) => Effect.Effect<EmployeeId>;
    readonly linkWorksAt: (arg0: EmployeeId, arg1: DepartmentId, arg2: { readonly since: number }) => Effect.Effect<void>;
    readonly updateEmployee: (arg0: EmployeeId, arg1: { readonly name?: string; readonly active?: boolean }) => Effect.Effect<void>;
    readonly retractEmployee: (arg0: EmployeeId) => Effect.Effect<void>;
  }
>()("OntologyRuntime") {}

export const hire = (name: string): Effect.Effect<EmployeeId, never, OntologyRuntime> =>
  Effect.gen(function* () {
    const ontologyRuntime = yield* OntologyRuntime;
    return yield* ontologyRuntime.createEmployee({ name, active: true });
  });

export const onboard = (
  name: string,
  department: DepartmentId,
): Effect.Effect<EmployeeId, never, OntologyRuntime> =>
  Effect.gen(function* () {
    const ontologyRuntime = yield* OntologyRuntime;
    const employee = yield* hire(name);
    const since = 2026;
    yield* ontologyRuntime.linkWorksAt(employee, department, { since });
    return employee;
  });

export const deactivate = (employee: EmployeeId): Effect.Effect<boolean, never, OntologyRuntime> =>
  Effect.gen(function* () {
    const ontologyRuntime = yield* OntologyRuntime;
    yield* ontologyRuntime.updateEmployee(employee, { active: false });
    return true;
  });

export const remove = (employee: EmployeeId): Effect.Effect<void, never, OntologyRuntime> =>
  Effect.gen(function* () {
    const ontologyRuntime = yield* OntologyRuntime;
    return yield* ontologyRuntime.retractEmployee(employee);
  });
