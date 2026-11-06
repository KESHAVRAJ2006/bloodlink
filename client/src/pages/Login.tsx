import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(phone, password);
      navigate("/profile");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <header>
        <h1 className="text-2xl">Donor login</h1>
        <p className="muted mt-1">
          Log in with the mobile number you registered. The password is checked against a bcrypt
          hash; the plain password is never stored.
        </p>
      </header>

      <form onSubmit={submit} className="card space-y-4">
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
          />
        </div>

        {error ? <p className="text-sm text-blood-700">{error}</p> : null}

        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? "Checking" : "Log in"}
        </button>

        <p className="muted text-center">
          Not registered yet?{" "}
          <Link to="/register" className="font-medium text-blood-700 hover:underline">
            Create a donor profile
          </Link>
        </p>
      </form>

      <p className="muted">
        Every donor created by the seeder uses the password demo1234, which is handy while testing.
      </p>
    </div>
  );
}
