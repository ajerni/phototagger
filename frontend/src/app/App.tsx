import { useEffect, useState } from "react";
import { Cpu, Database, MapPinned, ShieldCheck, WifiOff } from "lucide-react";
import { getHealth, type HealthResponse } from "../api/client";
import { TripWorkspace } from "../pages/TripWorkspace";

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const modelReady = Boolean(health?.model_available);

  useEffect(() => {
    getHealth()
      .then((payload) => {
        setHealth(payload);
        setHealthError(null);
      })
      .catch((error: Error) => {
        setHealth(null);
        setHealthError(error.message);
      });
  }, []);

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand-mark">
          <span className="brand-icon">
            <MapPinned size={24} aria-hidden="true" />
          </span>
          <div>
            <h1>Travel memories</h1>
            <p>AI photo descriptor by Andi.</p>
          </div>
        </div>

        <div className="top-status">
          <div className="privacy-chip">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>Private local workspace</span>
          </div>
          <div
            className={`status-pill ${
              health ? (modelReady ? "online" : "warning") : "offline"
            }`}
            title={health?.model_error ?? undefined}
          >
            {health ? (
              <>
                <Cpu size={16} aria-hidden="true" />
                <span>
                  {modelReady ? `${health.model} ready` : "Model not ready"}
                </span>
              </>
            ) : (
              <>
                <WifiOff size={16} aria-hidden="true" />
                <span>Backend offline</span>
              </>
            )}
          </div>
          {health ? (
            <div className="status-pill storage">
              <Database size={16} aria-hidden="true" />
              <span>{health.database}</span>
            </div>
          ) : null}
        </div>
      </header>

      <TripWorkspace health={health} healthError={healthError} />
    </main>
  );
}
