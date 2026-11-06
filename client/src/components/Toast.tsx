import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/**
 * Small toast stack. Used for ordinary confirmations and, more importantly, for
 * the live urgent request that arrives over Socket.IO.
 */

type Tone = "info" | "success" | "alert";

interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: Tone;
}

interface ToastValue {
  show: (title: string, body?: string, tone?: Tone) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

const TONE_CLASSES: Record<Tone, string> = {
  info: "border-l-ink-500 bg-white",
  success: "border-l-green-600 bg-white",
  alert: "border-l-blood-600 bg-blood-50",
};

const VISIBLE_MS = 7000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((title: string, body?: string, tone: Tone = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, title, body, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, VISIBLE_MS);
  }, []);

  const dismiss = (id: number) => setToasts((current) => current.filter((toast) => toast.id !== id));

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[1000] flex w-80 flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-lg border border-ink-500/15 border-l-4 p-3 shadow-card ${TONE_CLASSES[toast.tone]}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.body ? <p className="mt-0.5 text-xs text-ink-500">{toast.body}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="text-xs text-ink-500 hover:text-ink-900"
                aria-label="Dismiss"
              >
                close
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider.");
  return value;
}
