/** JSON boundary for process embeddings. One host instance owns daemon sessions. */
import { locateResponse } from "./diagnostic-locations.js";
import { Schema } from "effect";
import * as Engine from "@formalang/ts/engine";
import { TsLanguageHost } from "./ts-host.js";
import { HOST_OPERATIONS, HOST_CAPABILITIES, HOST_ABI_VERSION, JsonRequest, JsonResponse, semverVersion } from "./host-contract.js";
export { HOST_OPERATIONS, HOST_CAPABILITIES, HOST_ABI_VERSION, JsonRequest, JsonResponse, JsonDiagnostic, JsonValueProjection, TypeScheme, hostAbiSchema } from "./host-contract.js";
const errorResponse = (code: string, message: string): JsonResponse => ({ ok: false, diagnostics: [{ code, severity: "error", message }] });

export class JsonAbi {
  private readonly sessions = new Set<string>();
  constructor(readonly host = new TsLanguageHost()) {}

  async handleJson(text: string): Promise<JsonResponse> {
    let input: unknown;
    try { input = JSON.parse(text); } catch (error) { return errorResponse("abi/invalid-json", String(error)); }
    const op = input && typeof input === "object" && "op" in input ? input.op : undefined;
    if (typeof op !== "string") return errorResponse("abi/missing-op", "Request JSON must include a string op field.");
    const abiVersion = input && typeof input === "object" && "abiVersion" in input ? input.abiVersion : undefined;
    if (typeof abiVersion === "string" && Schema.is(semverVersion)(abiVersion) && abiVersion.split(".")[0] !== HOST_ABI_VERSION.split(".")[0]) {
      return errorResponse("abi/version-mismatch", `Request ABI ${abiVersion} is incompatible with host ABI ${HOST_ABI_VERSION}. Use the same major version.`);
    }
    if (input && typeof input === "object") {
      const config = input as {hostBuiltins?:unknown; typePolicy?:unknown; source?:unknown; sourceId?:unknown};
      try { Engine.validateHostTypes(config, typeof config.source === "string" ? config.source : ""); }
      catch (error) { return {ok:false, diagnostics:[Engine.diagnosticFromUnknown(error,"typecheck",typeof config.sourceId === "string" ? config.sourceId : "request")]}; }
    }
    let request: JsonRequest;
    try { request = Schema.decodeUnknownSync(JsonRequest)(input, { onExcessProperty: "error" }); }
    catch (error) {
      return errorResponse(HOST_CAPABILITIES.some(name => name === op) ? "abi/invalid-request" : "abi/unsupported-op", String(error));
    }
    const operation = HOST_OPERATIONS.find(operation => operation.name === request.op)!;
    if (operation.sessionScope !== "none" && "sessionId" in request && request.sessionId) {
      if (!this.sessions.has(request.sessionId)) return errorResponse("abi/unknown-session", `Unknown session ${request.sessionId}. Open a session first.`);
    }
    const inline = "source" in request && typeof request.source === "string" ? request.source : undefined;
    const sessionId = "sessionId" in request && typeof request.sessionId === "string" ? request.sessionId : undefined;
    // An inline source is the request's only unsaved text; session sources are looked up by id.
    const sourceText = (sourceId: string): string | undefined =>
      (sessionId ? this.host.sessionSourceText(sessionId, sourceId) : undefined) ?? inline;
    try {
      const result = await operation.project({ host: this.host, sessions: this.sessions }, request);
      const located = locateResponse(result, sourceText);
      Schema.decodeUnknownSync(operation.response)(located);
      return Schema.decodeUnknownSync(JsonResponse)(located);
    }
    catch (error) { return errorResponse("internal/error", `Internal error while handling ${op}: ${String(error)}`); }
  }
}
