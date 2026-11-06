import type { BloodGroup, GeoPoint, Urgency } from "./types";

/**
 * Leaflet wants [latitude, longitude] while GeoJSON and MongoDB store
 * [longitude, latitude]. Every conversion between the two goes through here, so
 * the swap is written once instead of in every map component.
 */
export function toLatLng(point: GeoPoint): [number, number] {
  const [longitude, latitude] = point.coordinates;
  return [latitude, longitude];
}

/** Colour per blood group, used by the map pins and the chart. */
export const BLOOD_GROUP_COLORS: Record<BloodGroup, string> = {
  "O+": "#a81f2c",
  "O-": "#6b1620",
  "A+": "#c62f3d",
  "A-": "#8a1a25",
  "B+": "#dc5a66",
  "B-": "#9d4e57",
  "AB+": "#ea9199",
  "AB-": "#5b3a3f",
};

export const URGENCY_COLORS: Record<Urgency, string> = {
  critical: "#8a1a25",
  urgent: "#c62f3d",
  normal: "#ea9199",
};

export function formatDate(value: string | null | undefined): string {
  if (!value) return "never";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "2 hours ago" style text for request cards. */
export function timeAgo(value: string): string {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** How long a request still has before the TTL index deletes it. */
export function timeLeft(value: string): string {
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60000);
  if (minutes <= 0) return "expired";
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} left`;
  return `${Math.round(hours / 24)} days left`;
}

export function formatDistance(km: number | undefined): string {
  if (km === undefined) return "";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}
