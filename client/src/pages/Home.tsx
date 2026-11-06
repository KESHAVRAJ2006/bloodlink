import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { BLOOD_GROUPS, type BloodGroup, type Stats } from "../lib/types";

/** Mysuru city centre, the fallback search point when geolocation is refused. */
const DEFAULT_POINT = { lng: 76.6394, lat: 12.2958 };

export function Home() {
  const navigate = useNavigate();
  const [bloodGroup, setBloodGroup] = useState<BloodGroup>("O+");
  const [stats, setStats] = useState<Stats | null>(null);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api.stats().then(setStats).catch(() => setStats(null));
  }, []);

  /** Hands the search point to the Find donors page through the query string. */
  function search(lng: number, lat: number) {
    navigate(`/find?lng=${lng}&lat=${lat}&bloodGroup=${encodeURIComponent(bloodGroup)}&km=10`);
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setNotice("This browser cannot share a location. Searching around Mysuru instead.");
      search(DEFAULT_POINT.lng, DEFAULT_POINT.lat);
      return;
    }

    setLocating(true);
    setNotice(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        // The browser gives latitude and longitude as named fields, which is
        // where the GeoJSON order gets swapped by mistake most often.
        search(position.coords.longitude, position.coords.latitude);
      },
      () => {
        setLocating(false);
        setNotice("Location permission was refused. Searching around Mysuru instead.");
        search(DEFAULT_POINT.lng, DEFAULT_POINT.lat);
      },
      { timeout: 8000 }
    );
  }

  return (
    <div className="space-y-12">
      <section className="grid items-center gap-8 md:grid-cols-5">
        <div className="md:col-span-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-blood-600">
            MongoDB geospatial project
          </p>
          <h1 className="mt-3 text-4xl leading-tight md:text-5xl">
            Find the nearest eligible blood donor in seconds.
          </h1>
          <p className="mt-4 max-w-xl text-ink-700">
            BloodLink stores every donor as a GeoJSON point and answers a search with a single
            MongoDB query. It returns only donors who are available, past the ninety day gap and
            compatible with the patient, sorted by real distance.
          </p>

          <div className="mt-6 card max-w-xl">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[160px]">
                <label className="label" htmlFor="home-group">
                  Patient blood group
                </label>
                <select
                  id="home-group"
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

              <button type="button" className="btn-primary" onClick={useMyLocation} disabled={locating}>
                {locating ? "Getting location" : "Use my location"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => search(DEFAULT_POINT.lng, DEFAULT_POINT.lat)}
              >
                Search around Mysuru
              </button>
            </div>
            {notice ? <p className="mt-3 text-xs text-blood-700">{notice}</p> : null}
          </div>
        </div>

        <div className="md:col-span-2">
          <div className="card space-y-4">
            <h2 className="section-title">Live numbers</h2>
            {stats ? (
              <dl className="grid grid-cols-2 gap-4">
                <Counter label="Registered donors" value={stats.totals.donors} />
                <Counter label="Eligible today" value={stats.totals.eligibleDonors} />
                <Counter label="Open requests" value={stats.totals.openRequests} />
                <Counter label="Hospitals" value={stats.totals.hospitals} />
              </dl>
            ) : (
              <p className="muted">
                Numbers load once the API is reachable and the database has been seeded.
              </p>
            )}
            <Link to="/dashboard" className="inline-block text-sm font-medium text-blood-700 hover:underline">
              Open the dashboard
            </Link>
          </div>
        </div>
      </section>

      <section>
        <h2 className="section-title">How a search works</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Step
            number="1"
            title="Point on the map"
            body="The browser location, a map click or a hospital address becomes a GeoJSON point with coordinates in [longitude, latitude] order."
          />
          <Step
            number="2"
            title="One aggregation"
            body="$geoNear uses the 2dsphere index to sort donors by distance, while the eligibility rule and the compatible blood groups are filtered inside the same stage."
          />
          <Step
            number="3"
            title="Private results"
            body="The list shows masked numbers. A full number is fetched only when somebody presses Contact, one donor at a time."
          />
        </div>
      </section>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="text-2xl font-semibold text-blood-700">{value}</dd>
    </div>
  );
}

function Step({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div className="card">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blood-50 text-sm font-semibold text-blood-700">
        {number}
      </span>
      <h3 className="mt-3 text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-ink-700">{body}</p>
    </div>
  );
}
