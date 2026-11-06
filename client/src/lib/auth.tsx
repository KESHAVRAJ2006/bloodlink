import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "./api";
import type { Donor } from "./types";

/**
 * Keeps the logged in donor in one place. The token lives in localStorage so a
 * page refresh does not log the user out; the donor record itself is fetched
 * again on load, which also catches a token that has expired.
 */

interface AuthValue {
  donor: Donor | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  /** Used by the register page, which already has a token from the API. */
  completeLogin: (token: string, donor: Donor) => void;
  logout: () => void;
  setDonor: (donor: Donor) => void;
}

const DONOR_ID_KEY = "bloodlink.donorId";

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [donor, setDonorState] = useState<Donor | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const donorId = localStorage.getItem(DONOR_ID_KEY);
    if (!getToken() || !donorId) {
      setLoading(false);
      return;
    }

    api
      .donor(donorId)
      .then((data) => setDonorState(data.donor))
      .catch(() => {
        setToken(null);
        localStorage.removeItem(DONOR_ID_KEY);
      })
      .finally(() => setLoading(false));
  }, []);

  function completeLogin(token: string, loggedIn: Donor) {
    setToken(token);
    localStorage.setItem(DONOR_ID_KEY, loggedIn._id);
    setDonorState(loggedIn);
  }

  const value = useMemo<AuthValue>(
    () => ({
      donor,
      loading,
      login: async (phone, password) => {
        const data = await api.login(phone, password);
        completeLogin(data.token, data.donor);
      },
      completeLogin,
      logout: () => {
        setToken(null);
        localStorage.removeItem(DONOR_ID_KEY);
        setDonorState(null);
      },
      setDonor: (updated) => {
        localStorage.setItem(DONOR_ID_KEY, updated._id);
        setDonorState(updated);
      },
    }),
    [donor, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
