import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { Navbar } from "./components/Navbar";
import { useToast } from "./components/Toast";
import { getSocket } from "./lib/socket";
import type { BloodRequest } from "./lib/types";
import { Dashboard } from "./pages/Dashboard";
import { FindDonors } from "./pages/FindDonors";
import { Home } from "./pages/Home";
import { Hospitals } from "./pages/Hospitals";
import { Login } from "./pages/Login";
import { Profile } from "./pages/Profile";
import { Queries } from "./pages/Queries";
import { Register } from "./pages/Register";
import { Requests } from "./pages/Requests";

/**
 * Listens for the change stream events the server forwards over Socket.IO and
 * raises a toast, whatever page the user happens to be on. The Requests page
 * listens to the same event separately to insert the request into its list.
 */
function LiveRequestToasts() {
  const toast = useToast();

  useEffect(() => {
    const socket = getSocket();

    function onNewRequest(request: BloodRequest) {
      const hospital = request.hospital?.name ?? "a hospital";
      toast.show(
        `${request.urgency === "normal" ? "New" : request.urgency.toUpperCase()} request: ${request.bloodGroup}`,
        `${request.unitsNeeded} unit(s) needed at ${hospital}`,
        request.urgency === "normal" ? "info" : "alert"
      );
    }

    socket.on("new-request", onNewRequest);
    return () => {
      socket.off("new-request", onNewRequest);
    };
  }, [toast]);

  return null;
}

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <LiveRequestToasts />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/find" element={<FindDonors />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/hospitals" element={<Hospitals />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/queries" element={<Queries />} />
          <Route
            path="*"
            element={<p className="muted">That page does not exist. Use the menu above.</p>}
          />
        </Routes>
      </main>

      <footer className="border-t border-ink-500/15 py-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 text-xs text-ink-500">
          <p>BloodLink - nearest blood donor finder built on MongoDB geospatial queries.</p>
          <p>
            Donor contact numbers are masked in every list and revealed one at a time. Map data from
            OpenStreetMap.
          </p>
        </div>
      </footer>
    </div>
  );
}
