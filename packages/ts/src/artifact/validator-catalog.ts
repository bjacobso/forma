import { validateMechanicsPayload } from "./mechanics-payloads.js";
import { ArtifactValidatorRegistry } from "./validator-registry.js";
import { registerDomainPayloadValidators } from "./domain-payloads.js";
import { validateHttpArtifacts } from "./http-validator.js";

export function makeArtifactValidatorRegistry(): ArtifactValidatorRegistry {
  const registry = new ArtifactValidatorRegistry();
  registerDomainPayloadValidators(registry);
  registry.register({ name: "payload-contract", validate: inputs => inputs.flatMap(validateMechanicsPayload) });
  for (const kind of ["SchemaDef", "ErrorDef", "ClassDef", "ServiceDef", "FunctionDef", "ValueDef", "LayerDef", "EffectDef"]) registry.registerPayload({ kind, validate: input => input.declaration.validators?.includes("payload-contract") ? [] : validateMechanicsPayload(input) });
  registry.register({ name: "http", kinds: ["HttpApi", "HttpHandle"], validate: validateHttpArtifacts });
  return registry;
}
