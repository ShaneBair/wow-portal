import { Route, Routes } from "react-router";
import { AuthProvider } from "./auth/auth-context.js";
import { ProtectedRoute } from "./auth/ProtectedRoute.js";
import { AppShell } from "./components/AppShell.js";
import { BoostsPage } from "./pages/BoostsPage.js";
import { HomePage } from "./pages/HomePage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { NotFoundPage } from "./pages/NotFoundPage.js";
import { StatsPage } from "./pages/StatsPage.js";
import { RosterPage } from "./pages/RosterPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/boosts" element={(
            <ProtectedRoute returnTo="/boosts">
              <BoostsPage />
            </ProtectedRoute>
          )} />
          <Route path="/roster" element={(
            <ProtectedRoute returnTo="/roster">
              <RosterPage />
            </ProtectedRoute>
          )} />
          <Route path="/settings" element={(
            <ProtectedRoute returnTo="/settings">
              <SettingsPage />
            </ProtectedRoute>
          )} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
