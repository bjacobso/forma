import { Runtime } from "foldkit";
import { TsLanguageHost } from "@formalang/host/ts-host";
import { FormaHost, Workbench, type WorkbenchConfig } from "@formalang/workbench";

import { capabilities } from "./program/capabilities";
import source from "./program/onboarding.forma?raw";
import workflow from "./program/workflow.lisp?raw";

const config: WorkbenchConfig = {
  sourceId: "onboarding.forma",
  preludes: [{ sourceId: "workflow.lisp", source: workflow }],
  capabilities,
};

const application = Runtime.makeElement({
  Model: Workbench.Model,
  init: () => Workbench.init({ id: "workbench", title: config.sourceId, source }),
  update: Workbench.update,
  view: Workbench.view,
  container: document.getElementById("root"),
  resources: FormaHost.layer(new TsLanguageHost(), config),
  // Report slow phases without sending the whole program model through Vite's console bridge.
  slow: {
    onSlow: ({ _tag, durationMs }) => console.warn(`[foldkit] Slow ${_tag}: ${durationMs.toFixed(1)}ms`),
  },
});

Runtime.run(application);
