import type { BootstrappedPrelude } from "./bootstrap.js";
import { FormDescriptorRegistry } from "./FormDescriptorRegistry.js";
import { ElaborationRegistry } from "./ElaborationRegistry.js";
import { ElaborationDescriptorRegistry } from "./ElaborationDescriptorRegistry.js";
import { createMetaFnHook } from "./meta-fn-executor.js";
import { createElaborationDescriptorHook } from "./elaboration-executor.js";
import { unifiedFormHooks } from "../surface/form.js";

/** Pure validated data, never JavaScript closures or host builtin factories. */
export type PreludeSnapshot = Omit<BootstrappedPrelude, "descriptions" | "elaboration" | "elaborationDescriptors" | "formBuiltins"> & {
  readonly descriptions: ReturnType<FormDescriptorRegistry["list"]>;
  readonly elaborationDescriptors: ReturnType<ElaborationDescriptorRegistry["list"]>;
};

export function capturePrelude(prelude: BootstrappedPrelude): PreludeSnapshot {
  const {descriptions, elaboration: _, elaborationDescriptors, formBuiltins: __, ...data} = prelude;
  return {...data,descriptions:descriptions.list(),elaborationDescriptors:elaborationDescriptors.list()};
}

/** Rebuild executable adapters from this build, over fresh registries. */
export function restorePrelude(snapshot: PreludeSnapshot): BootstrappedPrelude {
  const descriptions = new FormDescriptorRegistry(), elaboration = new ElaborationRegistry(), elaborationDescriptors = new ElaborationDescriptorRegistry();
  for (const descriptor of snapshot.descriptions) descriptions.register(descriptor);
  for (const hook of snapshot.typingHooks?.values() ?? []) {
    if (hook.kind === "bindings" || hook.kind === "validate" || hook.kind === "construct" || hook.kind === "result-type")
      elaboration.registerHook(createMetaFnHook(hook,undefined,{hostedDsls:snapshot.hostedDsls}));
  }
  for (const descriptor of snapshot.elaborationDescriptors) {
    elaborationDescriptors.register(descriptor);
    const disabled = ["1","true","TRUE","yes","YES"].includes(typeof process === "undefined" ? "" : process.env["FORMA_DISABLE_NATIVE_ELABORATION"] ?? "");
    if (!disabled || !elaboration.hasHook(descriptor.hook)) elaboration.registerHook(createElaborationDescriptorHook(descriptor));
  }
  for (const descriptor of descriptions.list()) for (const hook of unifiedFormHooks(descriptor,descriptions,undefined,snapshot.hostedDsls)) elaboration.registerHook(hook);
  return {...snapshot,descriptions,elaboration,elaborationDescriptors};
}
