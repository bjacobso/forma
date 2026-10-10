import { Runtime } from "foldkit";
import { TsLanguageHost } from "@formalang/host/ts-host";
import { Workspace } from "@formalang/workbench";
import { projects } from "./projects";

const application = Runtime.makeElement({
  Model: Workspace.Model,
  init: () =>
    Workspace.init({
      id: "workbench",
      projects,
      project: new URLSearchParams(window.location.search).get("project") ?? projects[0]!.id,
    }),
  update: Workspace.update,
  view: Workspace.view,
  container: document.getElementById("root"),
  resources: Workspace.layer(new TsLanguageHost(), projects),
  // …
});

Runtime.run(application);
