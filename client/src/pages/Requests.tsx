import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BloodGroupTag, StatusBadge, UrgencyBadge } from "../components/Badges";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import { formatDistance, timeAgo, timeLeft } from "../lib/format";
import { getSocket } from "../lib/socket";
import { BLOOD_GROUPS, type BloodGroup, type BloodRequest, type Donor, type Hospital } from "../lib/types";

export function Requests() {
  const toast = useToast();

  const [requests, setRequests] = useState<BloodRequest[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [status, setStatus] = useState("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Donor matching panel, opened from one request at a time.
  const [matchingFor, setMatchingFor] = useState<BloodRequest | null>(null);
  const [matches, setMatches] = useState<Donor[]>([]);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [recordingDonorId, setRecordingDonorId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.requests({ status: status || undefined });
      setRequests(data.requests);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not load requests.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
    api.hospitals().then((data) => setHospitals(data.hospitals)).catch(() => setHospitals([]));
  }, [load]);

  /**
   * The same change stream event that raises the toast also drops the new
   * request straight into this list, so nothing has to be refreshed by hand.
   */
  useEffect(() => {
    const socket = getSocket();

    function onNewRequest(incoming: BloodRequest) {
      setRequests((current) =>
        current.some((request) => request._id === incoming._id) ? current : [incoming, ...current]
      );
    }

    socket.on("new-request", onNewRequest);
    return () => {
      socket.off("new-request", onNewRequest);
    };
  }, []);

  async function cancel(request: BloodRequest) {
    try {
      await api.cancelRequest(request._id);
      toast.show("Request cancelled", `${request.patientName} is no longer listed.`, "success");
      void load();
    } catch (problem) {
      toast.show("Could not cancel", problem instanceof Error ? problem.message : "", "alert");
    }
  }

  async function openMatches(request: BloodRequest) {
    setMatchingFor(request);
    setMatches([]);
    setMatchError(null);
    try {
      const data = await api.hospitalNearbyDonors(request.hospitalId, {
        bloodGroup: request.bloodGroup,
        km: 25,
      });
      setMatches(data.donors.slice(0, 6));
      if (data.donors.length === 0) {
        setMatchError("No eligible compatible donor within 25 km of this hospital.");
      }
    } catch (problem) {
      setMatchError(problem instanceof Error ? problem.message : "Could not load donors.");
    }
  }

  async function recordDonation(request: BloodRequest, donor: Donor) {
    setRecordingDonorId(donor._id);
    try {
      const result = await api.recordDonation({
        donorId: donor._id,
        hospitalId: request.hospitalId,
        units: 1,
        requestId: request._id,
      });
      toast.show(
        "Donation recorded in one transaction",
        `${donor.name} donated, the request is ${result.requestFulfilled ? "fulfilled" : "still open"}.`,
        "success"
      );
      setMatchingFor(null);
      void load();
    } catch (problem) {
      toast.show("Could not record", problem instanceof Error ? problem.message : "", "alert");
    } finally {
      setRecordingDonorId(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl">Blood requests</h1>
          <p className="muted mt-1">
            New requests arrive here the moment a hospital saves one. A MongoDB change stream on the
            requests collection pushes them over Socket.IO, with no polling from the browser.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="status">
            Showing
          </label>
          <select
            id="status"
            className="input w-44"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="open">open</option>
            <option value="fulfilled">fulfilled</option>
            <option value="cancelled">cancelled</option>
            <option value="">all</option>
          </select>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-3 lg:col-span-2">
          {loading ? <p className="muted">Loading requests.</p> : null}
          {error ? <p className="text-sm text-blood-700">{error}</p> : null}
          {!loading && requests.length === 0 ? (
            <p className="muted">Nothing to show. Raise a request with the form beside this list.</p>
          ) : null}

          {requests.map((request) => (
            <article key={request._id} className="card">
              <div className="flex items-start gap-4">
                <BloodGroupTag group={request.bloodGroup} />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold">{request.patientName}</h2>
                    <UrgencyBadge urgency={request.urgency} />
                    <StatusBadge status={request.status} />
                  </div>
                  <p className="mt-1 text-sm text-ink-700">
                    {request.unitsNeeded} unit{request.unitsNeeded === 1 ? "" : "s"} needed at{" "}
                    {request.hospital?.name ?? "a hospital"}
                    {request.hospital?.city ? `, ${request.hospital.city}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-ink-500">
                    raised {timeAgo(request.createdAt)} - {timeLeft(request.expiresAt)} before the TTL
                    index removes it
                  </p>
                  {request.note ? <p className="mt-2 text-sm text-ink-700">{request.note}</p> : null}
                </div>

                {request.status === "open" ? (
                  <div className="flex shrink-0 flex-col gap-2">
                    <button type="button" className="btn-primary" onClick={() => void openMatches(request)}>
                      Find donors
                    </button>
                    <button type="button" className="btn-quiet" onClick={() => void cancel(request)}>
                      Cancel
                    </button>
                  </div>
                ) : null}
              </div>

              {matchingFor?._id === request._id ? (
                <div className="mt-4 border-t border-ink-500/10 pt-4">
                  <p className="text-sm font-medium">
                    Eligible compatible donors within 25 km of {request.hospital?.name ?? "the hospital"}
                  </p>
                  {matchError ? <p className="mt-2 text-sm text-blood-700">{matchError}</p> : null}

                  <ul className="mt-3 space-y-2">
                    {matches.map((donor) => (
                      <li
                        key={donor._id}
                        className="flex items-center gap-3 rounded-lg border border-ink-500/15 p-2"
                      >
                        <BloodGroupTag group={donor.bloodGroup} size="sm" />
                        <span className="flex-1 text-sm">
                          {donor.name}
                          <span className="text-ink-500"> - {formatDistance(donor.distanceKm)}</span>
                        </span>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={recordingDonorId === donor._id}
                          onClick={() => void recordDonation(request, donor)}
                        >
                          {recordingDonorId === donor._id ? "saving" : "Record donation"}
                        </button>
                      </li>
                    ))}
                  </ul>

                  <p className="muted mt-2">
                    Recording a donation writes the donation, updates the donor and fulfils the
                    request inside one transaction.
                  </p>
                </div>
              ) : null}
            </article>
          ))}
        </section>

        <NewRequestForm hospitals={hospitals} onCreated={() => void load()} />
      </div>
    </div>
  );
}

/**
 * A hospital raising a request. The insert is what the change stream picks up,
 * so submitting this form makes a toast appear in every open browser tab.
 */
function NewRequestForm({
  hospitals,
  onCreated,
}: {
  hospitals: Hospital[];
  onCreated: () => void;
}) {
  const toast = useToast();
  const [hospitalId, setHospitalId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [bloodGroup, setBloodGroup] = useState<BloodGroup>("O+");
  const [unitsNeeded, setUnitsNeeded] = useState("2");
  const [urgency, setUrgency] = useState("urgent");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hospitalId && hospitals.length > 0) setHospitalId(hospitals[0]._id);
  }, [hospitals, hospitalId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.createRequest({
        hospitalId,
        patientName,
        bloodGroup,
        unitsNeeded: Number(unitsNeeded),
        urgency,
        note: note || undefined,
      });
      toast.show(
        "Request saved",
        `It expires in ${result.expiresInHours} hours unless it is fulfilled.`,
        "success"
      );
      setPatientName("");
      setNote("");
      onCreated();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save the request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="card h-fit space-y-4">
      <div>
        <h2 className="section-title">Raise a request</h2>
        <p className="muted mt-1">
          Critical requests live for 12 hours, urgent for 24, normal for 72. After that the TTL
          index deletes them automatically.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="hospital">
          Hospital
        </label>
        <select
          id="hospital"
          className="input"
          value={hospitalId}
          onChange={(event) => setHospitalId(event.target.value)}
          required
        >
          {hospitals.map((hospital) => (
            <option key={hospital._id} value={hospital._id}>
              {hospital.name} ({hospital.city})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="patient">
          Patient name
        </label>
        <input
          id="patient"
          className="input"
          value={patientName}
          onChange={(event) => setPatientName(event.target.value)}
          required
          minLength={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="request-group">
            Blood group
          </label>
          <select
            id="request-group"
            className="input"
            value={bloodGroup}
            onChange={(event) => setBloodGroup(event.target.value as BloodGroup)}
          >
            {BLOOD_GROUPS.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="units">
            Units
          </label>
          <input
            id="units"
            type="number"
            min={1}
            max={20}
            className="input"
            value={unitsNeeded}
            onChange={(event) => setUnitsNeeded(event.target.value)}
            required
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="urgency">
          Urgency
        </label>
        <select
          id="urgency"
          className="input"
          value={urgency}
          onChange={(event) => setUrgency(event.target.value)}
        >
          <option value="normal">normal</option>
          <option value="urgent">urgent</option>
          <option value="critical">critical</option>
        </select>
      </div>

      <div>
        <label className="label" htmlFor="note">
          Note (optional)
        </label>
        <textarea
          id="note"
          className="input"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      {error ? <p className="text-sm text-blood-700">{error}</p> : null}

      <button type="submit" className="btn-primary w-full" disabled={submitting || !hospitalId}>
        {submitting ? "Saving" : "Save request"}
      </button>
    </form>
  );
}
