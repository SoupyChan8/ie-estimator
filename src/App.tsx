import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { SessionProvider, useSession } from "./lib/session";
import { Toaster } from "./lib/toast";
import Login from "./pages/Login";
import Estimator from "./pages/Estimator";
import Studio from "./pages/Studio";
import { Preloader } from "./components/Motion";

function Gate() {
  const { status } = useSession();
  if (status === "loading") return <div style={{ minHeight: "100dvh", background: "var(--background)" }} />;
  if (status === "signedOut") return <Login />;
  return (
    <Routes>
      <Route path="/" element={<Estimator />} />
      <Route path="/studio" element={<Studio />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Loader() {
  const { status, catalog, catalogError } = useSession();
  const ready = status === "signedOut" || (status === "signedIn" && (!!catalog || !!catalogError));
  return <Preloader ready={ready} />;
}

export default function App() {
  return (
    <SessionProvider>
      <Loader />
      <HashRouter>
        <Gate />
      </HashRouter>
      <Toaster />
    </SessionProvider>
  );
}
