import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Detection from "./pages/Detection";
import Cameras from "./pages/Cameras";
import MobileConnect from "./pages/MobileConnect";
import Live from "./pages/Live";
import Rules from "./pages/Rules";
import Violations from "./pages/Violations";
import Alerts from "./pages/Alerts";
import Workers from "./pages/Workers";
import Locations from "./pages/Locations";
import Zones from "./pages/Zones";
import Reports from "./pages/Reports";
import Analytics from "./pages/Analytics";
import Settings from "./pages/Settings";
import { NAV } from "./nav";

function Protected() {
  const { user, ready } = useAuth();
  if (!ready) return (
    <div className="grid min-h-screen place-items-center bg-bg">
      <div role="status" className="flex items-center gap-2 text-sm text-muted">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
        Loading SafeGuard AI...
      </div>
    </div>
  );
  return user ? <Layout /> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/camera/connect" element={<MobileConnect />} />
          <Route element={<Protected />}>
            <Route index element={<Dashboard />} />
            <Route path="/detection" element={<Detection />} />
            <Route path="/cameras" element={<Cameras />} />
            <Route path="/live" element={<Live />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/violations" element={<Violations />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/workers" element={<Workers />} />
            <Route path="/locations" element={<Locations />} />
            <Route path="/zones" element={<Zones />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
