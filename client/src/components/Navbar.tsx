import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

const LINKS = [
  { to: "/find", label: "Find donors" },
  { to: "/requests", label: "Requests" },
  { to: "/hospitals", label: "Hospitals" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/queries", label: "Queries" },
];

export function Navbar() {
  const { donor, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-[500] border-b border-ink-500/15 bg-white/95 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-blood-600 text-sm font-bold text-white">
            BL
          </span>
          <span className="text-lg font-semibold tracking-tight">BloodLink</span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm font-medium transition ${
                  isActive ? "bg-blood-50 text-blood-700" : "text-ink-700 hover:bg-ink-500/5"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {donor ? (
            <>
              <Link to="/profile" className="btn-quiet">
                {donor.name.split(" ")[0]}
              </Link>
              <button
                type="button"
                className="text-sm text-ink-500 hover:text-ink-900"
                onClick={() => {
                  logout();
                  navigate("/");
                }}
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn-quiet">
                Log in
              </Link>
              <Link to="/register" className="btn-primary">
                Register as donor
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
