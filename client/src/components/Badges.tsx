import { BLOOD_GROUP_COLORS } from "../lib/format";
import type { BloodGroup, RequestStatus, Urgency } from "../lib/types";

/** Round blood group chip, coloured the same way as the map pins. */
export function BloodGroupTag({ group, size = "md" }: { group: BloodGroup; size?: "sm" | "md" }) {
  const dimension = size === "sm" ? "h-7 w-9 text-xs" : "h-9 w-11 text-sm";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-bold text-white ${dimension}`}
      style={{ backgroundColor: BLOOD_GROUP_COLORS[group] }}
    >
      {group}
    </span>
  );
}

const URGENCY_CLASSES: Record<Urgency, string> = {
  critical: "bg-blood-800 text-white",
  urgent: "bg-blood-500 text-white",
  normal: "bg-blood-100 text-blood-800",
};

export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${URGENCY_CLASSES[urgency]}`}
    >
      {urgency}
    </span>
  );
}

const STATUS_CLASSES: Record<RequestStatus, string> = {
  open: "bg-amber-100 text-amber-800",
  fulfilled: "bg-green-100 text-green-800",
  cancelled: "bg-ink-500/10 text-ink-700",
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}>
      {status}
    </span>
  );
}

/** Green when the donor may donate today, grey when they are still waiting. */
export function EligibilityTag({ eligible }: { eligible: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        eligible ? "bg-green-100 text-green-800" : "bg-ink-500/10 text-ink-500"
      }`}
    >
      {eligible ? "eligible" : "not eligible"}
    </span>
  );
}
