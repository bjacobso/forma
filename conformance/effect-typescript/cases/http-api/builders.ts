import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, type HttpApiSchema } from "effect/unstable/httpapi";
import type { HttpRouter } from "effect/unstable/http";
type ErrorSchema<S> = S extends HttpApiSchema.WithHeaders<infer Inner, Schema.Top> ? Inner : S;
type ErrorSchemas<S extends readonly Schema.Top[]> = [Extract<ErrorSchema<S[number]>, HttpApiSchema.StreamSchema>] extends [never] ? S : never;

export type EndpointIR = { "kind": "HttpEndpoint", "name": string, "method": "get" | "post" | "put" | "patch" | "delete", "path": string, "params": Schema.Top | undefined, "payload": Schema.Top | undefined, "success": Schema.Top, "errors": readonly Schema.Top[] | undefined };

export const Endpoint = {
  get: <const Name extends string, const Path extends HttpRouter.PathInput, const Success extends Schema.Top, const Params extends Schema.Top = never, const Payload extends never = never, const Errors extends readonly Schema.Top[] = never>(name: Name, path: Path, options: { readonly "success": (Success); readonly "params"?: (Params) | undefined; readonly "payload"?: (Payload) | undefined; readonly "errors"?: (Errors & ErrorSchemas<NoInfer<Errors>>) | undefined }) => ({
    reference: { kind: "EndpointDecl", name: name } as const,
    ir: { "kind": "HttpEndpoint", "name": name, "method": "get", "path": path, "params": options["params"], "payload": options["payload"], "success": options["success"], "errors": options["errors"] } as const,
    value: HttpApiEndpoint.get<Name, Path, Params, never, Payload, never, Success, Errors>(name, path, { "success": options["success"], "error": options["errors"], "params": options["params"], "payload": options["payload"] }),
  }),
  post: <const Name extends string, const Path extends HttpRouter.PathInput, const Success extends Schema.Top, const Params extends Schema.Top = never, const Payload extends Schema.Top = never, const Errors extends readonly Schema.Top[] = never>(name: Name, path: Path, options: { readonly "success": (Success); readonly "params"?: (Params) | undefined; readonly "payload"?: (Payload) | undefined; readonly "errors"?: (Errors & ErrorSchemas<NoInfer<Errors>>) | undefined }) => ({
    reference: { kind: "EndpointDecl", name: name } as const,
    ir: { "kind": "HttpEndpoint", "name": name, "method": "post", "path": path, "params": options["params"], "payload": options["payload"], "success": options["success"], "errors": options["errors"] } as const,
    value: HttpApiEndpoint.post<Name, Path, Params, never, Payload, never, Success, Errors>(name, path, { "success": options["success"], "error": options["errors"], "params": options["params"], "payload": options["payload"] }),
  }),
  put: <const Name extends string, const Path extends HttpRouter.PathInput, const Success extends Schema.Top, const Params extends Schema.Top = never, const Payload extends Schema.Top = never, const Errors extends readonly Schema.Top[] = never>(name: Name, path: Path, options: { readonly "success": (Success); readonly "params"?: (Params) | undefined; readonly "payload"?: (Payload) | undefined; readonly "errors"?: (Errors & ErrorSchemas<NoInfer<Errors>>) | undefined }) => ({
    reference: { kind: "EndpointDecl", name: name } as const,
    ir: { "kind": "HttpEndpoint", "name": name, "method": "put", "path": path, "params": options["params"], "payload": options["payload"], "success": options["success"], "errors": options["errors"] } as const,
    value: HttpApiEndpoint.put<Name, Path, Params, never, Payload, never, Success, Errors>(name, path, { "success": options["success"], "error": options["errors"], "params": options["params"], "payload": options["payload"] }),
  }),
  patch: <const Name extends string, const Path extends HttpRouter.PathInput, const Success extends Schema.Top, const Params extends Schema.Top = never, const Payload extends Schema.Top = never, const Errors extends readonly Schema.Top[] = never>(name: Name, path: Path, options: { readonly "success": (Success); readonly "params"?: (Params) | undefined; readonly "payload"?: (Payload) | undefined; readonly "errors"?: (Errors & ErrorSchemas<NoInfer<Errors>>) | undefined }) => ({
    reference: { kind: "EndpointDecl", name: name } as const,
    ir: { "kind": "HttpEndpoint", "name": name, "method": "patch", "path": path, "params": options["params"], "payload": options["payload"], "success": options["success"], "errors": options["errors"] } as const,
    value: HttpApiEndpoint.patch<Name, Path, Params, never, Payload, never, Success, Errors>(name, path, { "success": options["success"], "error": options["errors"], "params": options["params"], "payload": options["payload"] }),
  }),
  delete_: <const Name extends string, const Path extends HttpRouter.PathInput, const Success extends Schema.Top, const Params extends Schema.Top = never, const Payload extends never = never, const Errors extends readonly Schema.Top[] = never>(name: Name, path: Path, options: { readonly "success": (Success); readonly "params"?: (Params) | undefined; readonly "payload"?: (Payload) | undefined; readonly "errors"?: (Errors & ErrorSchemas<NoInfer<Errors>>) | undefined }) => ({
    reference: { kind: "EndpointDecl", name: name } as const,
    ir: { "kind": "HttpEndpoint", "name": name, "method": "delete", "path": path, "params": options["params"], "payload": options["payload"], "success": options["success"], "errors": options["errors"] } as const,
    value: HttpApiEndpoint.delete<Name, Path, Params, never, Payload, never, Success, Errors>(name, path, { "success": options["success"], "error": options["errors"], "params": options["params"], "payload": options["payload"] }),
  }),
};

export type GroupIR = { "kind": "HttpGroup", "name": string, "endpoints": readonly EndpointIR[] };

export class GroupBuilder<const Name extends string, const Children extends readonly { readonly ir: EndpointIR; readonly value: HttpApiEndpoint.Constraint }[]> {
  constructor(readonly name: Name, readonly children: Children, readonly value: HttpApiGroup.HttpApiGroup<Name, Children[number]["value"]>) {}
  get reference() { return { kind: "GroupDecl", name: this.name } as const; }
  get ir() { return { "kind": "HttpGroup", "name": this.name, "endpoints": this.children.map((child: Children[number]) => child.ir) } as const; }
  add<const Child extends { readonly ir: EndpointIR; readonly value: HttpApiEndpoint.Constraint }>(child: Child) {
    return new GroupBuilder<Name, readonly [...Children, Child]>(this.name, [...this.children, child] as const, this.value.add(child.value));
  }
}
export const Group = {
  make: <const Name extends string>(name: Name) => ({
    reference: { kind: "GroupDecl", name } as const,
    ir: { "kind": "HttpGroup", "name": name, "endpoints": [] } as const,
    add: <const Child extends { readonly ir: EndpointIR; readonly value: HttpApiEndpoint.Constraint }>(child: Child) => new GroupBuilder(name, [child] as const, HttpApiGroup.make(name).add(child.value)),
  }),
};

export type ApiIR = { "kind": "HttpApi", "name": string, "groups": readonly GroupIR[] };

export class ApiBuilder<const Name extends string, const Children extends readonly { readonly ir: GroupIR; readonly value: HttpApiGroup.Constraint }[]> {
  constructor(readonly name: Name, readonly children: Children, readonly value: HttpApi.HttpApi<Name, Children[number]["value"]>) {}
  get reference() { return { kind: "ApiDecl", name: this.name } as const; }
  get ir() { return { "kind": "HttpApi", "name": this.name, "groups": this.children.map((child: Children[number]) => child.ir) } as const; }
  add<const Child extends { readonly ir: GroupIR; readonly value: HttpApiGroup.Constraint }>(child: Child) {
    return new ApiBuilder<Name, readonly [...Children, Child]>(this.name, [...this.children, child] as const, this.value.add(child.value));
  }
}
export const Api = {
  make: <const Name extends string>(name: Name) => ({
    reference: { kind: "ApiDecl", name } as const,
    ir: { "kind": "HttpApi", "name": name, "groups": [] } as const,
    add: <const Child extends { readonly ir: GroupIR; readonly value: HttpApiGroup.Constraint }>(child: Child) => new ApiBuilder(name, [child] as const, HttpApi.make(name).add(child.value)),
  }),
};
