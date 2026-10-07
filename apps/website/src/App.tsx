import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { SiteHeader } from "./components/SiteHeader";
import { WorkbenchPage } from "./pages/WorkbenchPage";
import { Home } from "./pages/Home";

const About = lazy(() =>
  import("./pages/About").then((module) => ({ default: module.About })),
);
const DemoGallery = lazy(() =>
  import("./pages/DemoGallery").then((module) => ({ default: module.DemoGallery })),
);
const DemoPipeline = lazy(() =>
  import("./pages/DemoPipeline").then((module) => ({ default: module.DemoPipeline })),
);

export function App() {
  const location = useLocation();
  return (
    <>
      {!location.pathname.startsWith("/embed/") ? <SiteHeader /> : null}
      <Suspense fallback={<main className="route-loading">Loading...</main>}>
        <Routes>
          <Route element={<Home />} path="/" />
          <Route element={<WorkbenchPage embedded />} path="/embed/:exampleId" />
          <Route element={<WorkbenchPage />} path="/live/:exampleId" />
          <Route element={<About />} path="/about" />
          <Route element={<DemoGallery />} path="/demo" />
          <Route element={<DemoPipeline />} path="/demo/:pipelineId" />
          <Route element={<Navigate replace to="/" />} path="*" />
        </Routes>
      </Suspense>
    </>
  );
}
