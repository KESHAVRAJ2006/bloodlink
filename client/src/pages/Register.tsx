import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ClickToPick, MapView, RecenterMap, SearchPointMarker } from "../components/MapView";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { toLatLng } from "../lib/format";
import { BLOOD_GROUPS, type BloodGroup, type GeoPoint } from "../lib/types";

/** Where the map starts, and the cities the seeded zones cover. */
const CITY_CENTRES: Record<string, [number, number]> = {
  Mysuru: [76.6394, 12.2958],
  Mandya: [76.8958, 12.5218],
  Bengaluru: [77.5946, 12.9716],
};

export function Register() {
  const navigate = useNavigate();
  const toast = useToast();
  const { completeLogin } = useAuth();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [bloodGroup, setBloodGroup] = useState<BloodGroup>("O+");
  const [age, setAge] = useState("22");
  const [gender, setGender] = useState("male");
  const [city, setCity] = useState("Mysuru");
  const [point, setPoint] = useState<[number, number]>(CITY_CENTRES.Mysuru as [number, number]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const location = useMemo<GeoPoint>(() => ({ type: "Point", coordinates: point }), [point]);

  function changeCity(nextCity: string) {
    setCity(nextCity);
    const centre = CITY_CENTRES[nextCity];
    if (centre) setPoint(centre);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await api.register({
        name,
        phone,
        email: email || undefined,
        password,
        bloodGroup,
        age: Number(age),
        gender,
        city,
        lng: point[0],
        lat: point[1],
      });

      completeLogin(result.token, result.donor);
      toast.show("Registration complete", "You can now be found in nearby searches.", "success");
      navigate("/profile");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Registration failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl">Register as a donor</h1>
        <p className="muted mt-1">
          Your location is stored as a GeoJSON point, which is what makes the nearby search
          possible. Pick it by clicking the map, as close to your area as you are comfortable with.
        </p>
      </header>

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="name">
                Full name
              </label>
              <input
                id="name"
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                minLength={2}
              />
            </div>

            <div>
              <label className="label" htmlFor="phone">
                Mobile number
              </label>
              <input
                id="phone"
                className="input"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                required
                pattern="[6-9][0-9]{9}"
                placeholder="10 digits"
                title="A 10 digit Indian mobile number"
              />
            </div>

            <div>
              <label className="label" htmlFor="email">
                Email (optional)
              </label>
              <input
                id="email"
                type="email"
                className="input"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={6}
              />
            </div>

            <div>
              <label className="label" htmlFor="group">
                Blood group
              </label>
              <select
                id="group"
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
              <label className="label" htmlFor="age">
                Age
              </label>
              <input
                id="age"
                type="number"
                min={18}
                max={65}
                className="input"
                value={age}
                onChange={(event) => setAge(event.target.value)}
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="gender">
                Gender
              </label>
              <select
                id="gender"
                className="input"
                value={gender}
                onChange={(event) => setGender(event.target.value)}
              >
                <option value="male">male</option>
                <option value="female">female</option>
                <option value="other">other</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="label" htmlFor="city">
                City
              </label>
              <select
                id="city"
                className="input"
                value={city}
                onChange={(event) => changeCity(event.target.value)}
              >
                {Object.keys(CITY_CENTRES).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-lg bg-blood-50 p-3 text-xs text-blood-800">
            Age must be between 18 and 65, the same rule the database enforces with $jsonSchema.
            Only a masked version of your number is ever shown in search results.
          </div>

          {error ? <p className="text-sm text-blood-700">{error}</p> : null}

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? "Saving" : "Create my donor profile"}
          </button>
        </div>

        <div className="space-y-3">
          <MapView center={toLatLng(location)} zoom={13} className="h-[420px] overflow-hidden rounded-xl border border-ink-500/15">
            <RecenterMap center={toLatLng(location)} />
            <ClickToPick
              onPick={(lng, lat) => setPoint([Number(lng.toFixed(6)), Number(lat.toFixed(6))])}
            />
            <SearchPointMarker point={location} label="me" />
          </MapView>

          <div className="card">
            <p className="label">Stored location</p>
            <p className="font-mono text-sm">
              {"{ type: \"Point\", coordinates: ["}
              {point[0]}, {point[1]}
              {"] }"}
            </p>
            <p className="muted mt-2">
              Longitude first, then latitude. MongoDB rejects the document if the order or the range
              is wrong.
            </p>
          </div>
        </div>
      </form>
    </div>
  );
}
