import { useState, useEffect, Suspense, lazy } from "react";
import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Settings as SettingsIcon,
  Home,
  ListOrdered,
  Plus,
  BarChart3,
} from "lucide-react";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import RegistrationWizard from "./pages/RegistrationWizard";

// Loaded on demand: not needed for the first render (the Dashboard shows
// after login), and Analytics pulls in recharts, the heaviest dependency.
const Transactions = lazy(() => import("./pages/Transactions"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Settings = lazy(() => import("./pages/Settings"));

import { apiFetch } from "./services/api";
import { setCurrency } from "./utils/format";

function App() {
  const { t } = useTranslation();
  // Public instance configuration (/api/config), loaded before anything else.
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  // Session-cookie authentication
  const [isAuthed, setIsAuthed] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  // Current user (id/username/isOwner): Settings uses isOwner to show the
  // full database download (it contains every user's data, owner only).
  const [user, setUser] = useState(null);
  // Shown once, right after registration (not after login).
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  const location = useLocation();
  const isActive = (path) => location.pathname === path;

  // On startup: instance configuration, then the existing session (if any).
  useEffect(() => {
    const checkSession = async () => {
      try {
        const config = await (await apiFetch("/api/config")).json();
        setCurrency(config.currency);
        setRegistrationEnabled(!!config.registrationEnabled);
      } catch {
        // Defaults: EUR, registration hidden
      }
      try {
        const res = await apiFetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
          setIsAuthed(true);
        } else {
          setIsAuthed(false);
        }
        // eslint-disable-next-line no-unused-vars
      } catch (err) {
        // NOT_AUTHORIZED or network error
        setIsAuthed(false);
      } finally {
        setCheckingAuth(false);
      }
    };

    checkSession();
  }, []);

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-300">
        {t("common.loading")}
      </div>
    );
  }

  if (!isAuthed) {
    return (
      <Login
        registrationEnabled={registrationEnabled}
        onAuthed={(loggedUser, { justRegistered } = {}) => {
          setUser(loggedUser);
          setIsAuthed(true);
          if (justRegistered) setNeedsOnboarding(true);
        }}
      />
    );
  }

  if (needsOnboarding) {
    return <RegistrationWizard onDone={() => setNeedsOnboarding(false)} />;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 transition-colors duration-200 flex flex-col">
      {/* Top Bar */}
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-20 pt-safe">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <h1 className="flex items-center">
              <img
                src="/logo-color.svg"
                alt="Konto"
                className="h-7 w-auto dark:hidden"
              />
              <img
                src="/logo-white.svg"
                alt="Konto"
                className="h-7 w-auto hidden dark:block"
              />
            </h1>

            {/* Desktop nav */}
            <div className="hidden sm:flex gap-4">
              <Link
                to="/"
                className={`flex items-center gap-2 text-sm font-medium transition-colors ${
                  isActive("/")
                    ? "text-primary-600 dark:text-primary-400"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                }`}
              >
                <Home className="w-4 h-4" /> {t("nav.dashboard")}
              </Link>

              <Link
                to="/transactions"
                className={`flex items-center gap-2 text-sm font-medium transition-colors ${
                  isActive("/transactions")
                    ? "text-primary-600 dark:text-primary-400"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                }`}
              >
                <ListOrdered className="w-4 h-4" /> {t("nav.transactions")}
              </Link>

              <Link
                to="/analytics"
                className={`flex items-center gap-2 text-sm font-medium transition-colors ${
                  isActive("/analytics")
                    ? "text-primary-600 dark:text-primary-400"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                }`}
              >
                <BarChart3 className="w-4 h-4" /> {t("nav.analytics")}
              </Link>

              <Link
                to="/settings"
                className={`flex items-center gap-2 text-sm font-medium transition-colors ${
                  isActive("/settings")
                    ? "text-primary-600 dark:text-primary-400"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                }`}
              >
                <SettingsIcon className="w-4 h-4" /> {t("nav.settings")}
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Main */}
      <main className="flex-1 max-w-6xl mx-auto w-full pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pb-8">
        <Suspense
          fallback={
            <div className="p-6 text-center text-gray-500 dark:text-gray-400">
              {t("common.loading")}
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route
              path="/settings"
              element={<Settings user={user} setAuth={setIsAuthed} />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-800/90 backdrop-blur pb-safe">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between relative">
          <Link
            to="/"
            className={`flex flex-col items-center justify-center w-16 transition-colors ${
              isActive("/")
                ? "text-primary-600 dark:text-primary-400"
                : "text-gray-400 dark:text-gray-500"
            }`}
          >
            <Home className="w-6 h-6 mb-1" />
            <span className="text-[10px] font-medium">{t("nav.home")}</span>
          </Link>

          <Link
            to="/transactions"
            className={`flex flex-col items-center justify-center w-16 transition-colors ${
              isActive("/transactions")
                ? "text-primary-600 dark:text-primary-400"
                : "text-gray-400 dark:text-gray-500"
            }`}
          >
            <ListOrdered className="w-6 h-6 mb-1" />
            <span className="text-[10px] font-medium">{t("nav.transactions")}</span>
          </Link>

          {/* Center spacer (notch for the FAB) */}
          <div className="w-16" aria-hidden="true" />

          <Link
            to="/analytics"
            className={`flex flex-col items-center justify-center w-16 transition-colors ${
              isActive("/analytics")
                ? "text-primary-600 dark:text-primary-400"
                : "text-gray-400 dark:text-gray-500"
            }`}
          >
            <BarChart3 className="w-6 h-6 mb-1" />
            <span className="text-[10px] font-medium">{t("nav.analytics")}</span>
          </Link>

          <Link
            to="/settings"
            className={`flex flex-col items-center justify-center w-16 transition-colors ${
              isActive("/settings")
                ? "text-primary-600 dark:text-primary-400"
                : "text-gray-400 dark:text-gray-500"
            }`}
          >
            <SettingsIcon className="w-6 h-6 mb-1" />
            <span className="text-[10px] font-medium">{t("nav.settings")}</span>
          </Link>

          {/* FAB */}
          <Link
            to="/transactions?action=add"
            className="absolute left-1/2 -translate-x-1/2 -top-7 bg-primary-600 hover:bg-primary-700 text-white w-14 h-14 rounded-full shadow-xl flex items-center justify-center border-4 border-gray-50 dark:border-gray-900 active:scale-95 transition-transform"
            aria-label={t("nav.addTransaction")}
            title={t("nav.addTransaction")}
          >
            <Plus className="w-7 h-7" />
          </Link>
        </div>
      </nav>
    </div>
  );
}

export default App;
