import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { SiteFooter } from "./components/SiteFooter";
import { SiteHeader } from "./components/SiteHeader";
import { WorkbenchPage } from "./pages/WorkbenchPage";
import { Home } from "./pages/Home";

const PreludePlayground = lazy(() =>
  import("./pages/PreludePlayground").then((module) => ({ default: module.PreludePlayground })),
);
const DemoGallery = lazy(() =>
  import("./pages/DemoGallery").then((module) => ({ default: module.DemoGallery })),
);
const DemoPipeline = lazy(() =>
  import("./pages/DemoPipeline").then((module) => ({ default: module.DemoPipeline })),
);

export function App() {
  const location = useLocation();
  const embedded = location.pathname.startsWith("/embed/");
  return (
    <>
      {!embedded ? <SiteHeader /> : null}
      <Suspense fallback={<main className="route-loading">Loading...</main>}>
        <Routes>
          <Route element={<Home />} path="/" />
          <Route element={<PreludePlayground />} path="/custom" />
          <Route element={<PreludePlayground />} path="/p/:snapshotId" />
          <Route element={<PreludePlayground embedded />} path="/embed/custom" />
          <Route element={<WorkbenchPage embedded />} path="/embed/:exampleId" />
          <Route element={<WorkbenchPage />} path="/live/:exampleId" />
          <Route element={<DemoGallery />} path="/demo" />
          <Route element={<DemoPipeline />} path="/demo/:pipelineId" />
          <Route element={<Navigate replace to="/" />} path="*" />
        </Routes>
      </Suspense>
      {!embedded ? <SiteFooter /> : null}
    </>
  );
}
