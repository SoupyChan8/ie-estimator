import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { SessionProvider, useSession } from "./lib/session";
import { Toaster } from "./lib/toast";
import Login from "./pages/Login";
import Estimator from "./pages/Estimator";
import Studio from "./pages/Studio";

function Gate() {
  const { status } = useSession();
  if (status === "loading") return <div style={{ minHeight: "100dvh", background: "#15130f" }} />;
  if (status === "signedOut") return <Login />;
  return (
    <Routes>
      <Route path="/" element={<Estimator />} />
      <Route path="/studio" element={<Studio />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <HashRouter>
        <Gate />
      </HashRouter>
      <Toaster />
    </SessionProvider>
  );
}
