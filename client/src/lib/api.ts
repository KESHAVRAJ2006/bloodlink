import type {
  BloodGroup,
  BloodRequest,
  CityZone,
  DemoQuery,
  DemoQueryResult,
  DonationRecord,
  Donor,
  Hospital,
  NearbyResponse,
  Stats,
} from "./types";
import { API_URL } from "./config";

const TOKEN_KEY = "bloodlink.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/**
 * One place where every call to the API goes through. It attaches the token,
 * parses the JSON and turns an error response into a thrown Error carrying the
 * message the server wrote, so the pages can show it directly.
 */
async function callApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    // fetch only rejects when the request never got a response: the API is
    // down, the URL is wrong, or the browser blocked it (CORS, mixed content).
    throw new Error(`Cannot reach the API at ${API_URL}. Is it running, and is VITE_API_URL correct?`);
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data.error ?? `Request failed with status ${response.status}`);
  }
  return data as T;
}

const post = <T>(path: string, body: unknown) =>
  callApi<T>(path, { method: "POST", body: JSON.stringify(body) });

const patch = <T>(path: string, body: unknown) =>
  callApi<T>(path, { method: "PATCH", body: JSON.stringify(body) });

/** Builds a query string, leaving out anything undefined or empty. */
function query(parameters: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const asString = search.toString();
  return asString ? `?${asString}` : "";
}

export interface RegisterInput {
  name: string;
  phone: string;
  email?: string;
  password: string;
  bloodGroup: BloodGroup;
  age: number;
  gender: string;
  city: string;
  lng: number;
  lat: number;
}

export const api = {
  health: () => callApi<{ status: string; time: string }>("/api/health"),

  register: (input: RegisterInput) =>
    post<{ token: string; donor: Donor }>("/api/auth/register", input),

  login: (phone: string, password: string) =>
    post<{ token: string; donor: Donor }>("/api/auth/login", { phone, password }),

  nearbyDonors: (parameters: {
    lng: number;
    lat: number;
    km: number;
    bloodGroup?: BloodGroup;
    compatible?: boolean;
    limit?: number;
  }) => callApi<NearbyResponse>(`/api/donors/nearby${query(parameters)}`),

  donorsInCity: (city: string, parameters: { bloodGroup?: BloodGroup; eligibleOnly?: boolean } = {}) =>
    callApi<{ zone: CityZone; count: number; donors: Donor[] }>(
      `/api/donors/in-city/${encodeURIComponent(city)}${query(parameters)}`
    ),

  donor: (id: string) => callApi<{ donor: Donor }>(`/api/donors/${id}`),

  donorContact: (id: string) => callApi<{ name: string; phone: string }>(`/api/donors/${id}/contact`),

  donorDonations: (id: string) =>
    callApi<{ count: number; donations: DonationRecord[] }>(`/api/donors/${id}/donations`),

  setAvailability: (id: string, available: boolean) =>
    patch<{ donor: Donor }>(`/api/donors/${id}/availability`, { available }),

  updateDonor: (id: string, updates: Record<string, unknown>) =>
    callApi<{ donor: Donor }>(`/api/donors/${id}`, { method: "PUT", body: JSON.stringify(updates) }),

  hospitals: () => callApi<{ count: number; hospitals: Hospital[] }>("/api/hospitals"),

  hospitalNearbyDonors: (id: string, parameters: { bloodGroup?: BloodGroup; km?: number }) =>
    callApi<{
      hospital: Hospital;
      radiusKm: number;
      compatibleGroups: BloodGroup[] | null;
      count: number;
      donors: Donor[];
    }>(`/api/hospitals/${id}/nearby-donors${query(parameters)}`),

  requests: (parameters: { status?: string; bloodGroup?: BloodGroup; urgency?: string } = {}) =>
    callApi<{ count: number; requests: BloodRequest[] }>(`/api/requests${query(parameters)}`),

  createRequest: (input: {
    hospitalId: string;
    patientName: string;
    bloodGroup: BloodGroup;
    unitsNeeded: number;
    urgency: string;
    note?: string;
  }) => post<{ request: BloodRequest; hospitalName: string; expiresInHours: number }>("/api/requests", input),

  cancelRequest: (id: string) => patch<{ request: BloodRequest }>(`/api/requests/${id}/cancel`, {}),

  recordDonation: (input: { donorId: string; hospitalId: string; units: number; requestId?: string }) =>
    post<{ donationId: string; requestFulfilled: boolean; message: string }>("/api/donations", input),

  stats: () => callApi<Stats>("/api/stats"),

  zones: () => callApi<{ count: number; zones: CityZone[] }>("/api/zones"),

  demoQueries: () => callApi<{ count: number; queries: DemoQuery[] }>("/api/demo-queries"),

  runDemoQuery: (id: string) => post<DemoQueryResult>(`/api/demo-queries/${id}/run`, {}),
};
