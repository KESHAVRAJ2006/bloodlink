import { createServer } from "node:http";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { Server as SocketServer } from "socket.io";
import {
  ALLOWED_ORIGINS,
  IS_PRODUCTION,
  PORT,
  describeConfig,
  isOriginAllowed,
} from "./config.js";
import { closeDatabase, connectToDatabase, isDatabaseReachable } from "./db.js";
import authRoutes from "./routes/auth.js";
import demoQueryRoutes from "./routes/demoQueries.js";
import donationRoutes from "./routes/donations.js";
import donorRoutes from "./routes/donors.js";
import hospitalRoutes from "./routes/hospitals.js";
import requestRoutes from "./routes/requests.js";
import statsRoutes from "./routes/stats.js";
import zoneRoutes from "./routes/zones.js";
import { ApiError } from "./utils/http.js";
import { startRequestWatcher, stopRequestWatcher } from "./watcher.js";

const app = express();
const httpServer = createServer(app);

/**
 * CORS. The browser refuses to read a response from another origin unless that
 * origin is on this list, so the deployed React site and a laptop dev server
 * both have to be named in CLIENT_URL.
 *
 * The callback form is used instead of a plain string so the comma-separated
 * list and the "*.vercel.app" wildcard both work.
 */
const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      callback(null, true);
      return;
    }
    // A clear log line here saves a lot of guessing when the browser only says
    // "blocked by CORS policy".
    console.warn(`CORS: refused origin ${origin}. CLIENT_URL allows: ${ALLOWED_ORIGINS.join(", ")}`);
    callback(new Error(`Origin ${origin} is not allowed by CLIENT_URL.`));
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

// Socket.IO needs its own CORS settings; the Express ones do not apply to it.
const io = new SocketServer(httpServer, {
  cors: {
    origin(origin, callback) {
      callback(null, isOriginAllowed(origin ?? undefined));
    },
    credentials: true,
  },
});

io.on("connection", (socket) => {
  console.log(`socket connected: ${socket.id} (${socket.conn.transport.name})`);
  // Socket.IO starts on HTTP long polling and upgrades to a WebSocket. Logging
  // the upgrade proves the WebSocket really is in use on the host.
  socket.conn.on("upgrade", () => {
    console.log(`socket ${socket.id} upgraded to ${socket.conn.transport.name}`);
  });
  socket.on("disconnect", (reason) => console.log(`socket disconnected: ${socket.id} (${reason})`));
});

/**
 * GET /api/health
 * Used by Render to see that the service is alive, by the uptime pinger that
 * keeps the free instance awake, and by you to check a deployment in one click.
 * It pings MongoDB, so it answers the real question: can this API serve data?
 */
app.get("/api/health", async (_request, response) => {
  const connected = await isDatabaseReachable();
  response.status(connected ? 200 : 503).json({
    status: connected ? "ok" : "degraded",
    db: connected ? "connected" : "disconnected",
    uptimeSeconds: Math.round(process.uptime()),
    time: new Date().toISOString(),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/donors", donorRoutes);
app.use("/api/hospitals", hospitalRoutes);
app.use("/api/requests", requestRoutes);
app.use("/api/donations", donationRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/zones", zoneRoutes);
app.use("/api/demo-queries", demoQueryRoutes);

/** A plain visit to the Render URL should say something useful, not 404. */
app.get("/", (_request, response) => {
  response.json({
    name: "BloodLink API",
    health: "/api/health",
    docs: "see README.md for the full route list",
  });
});

/** Anything that did not match a route above. */
app.use((request, response) => {
  response.status(404).json({ error: `No API route for ${request.method} ${request.path}` });
});

/**
 * One error handler for the whole API. Routes throw, this turns the error into
 * JSON with a sensible status code. Express recognises it as an error handler
 * because it takes four arguments.
 */
app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof ApiError) {
    response.status(error.status).json({ error: error.message });
    return;
  }

  // A unique index rejected the write, which in this project only happens on a
  // duplicate phone number.
  if (typeof error === "object" && error !== null && (error as { code?: number }).code === 11000) {
    response.status(409).json({ error: "That value is already registered." });
    return;
  }

  // MongoDB schema validation rejected the document. errInfo says which rule
  // failed, which is too detailed for the UI but exactly what is needed in the
  // terminal while fixing it.
  if (typeof error === "object" && error !== null && (error as { code?: number }).code === 121) {
    console.error("schema validation failed:", JSON.stringify((error as { errInfo?: unknown }).errInfo));
    response.status(400).json({ error: "The database rejected this record: it failed schema validation." });
    return;
  }

  // The CORS middleware rejected the origin.
  if (error instanceof Error && error.message.includes("not allowed by CLIENT_URL")) {
    response.status(403).json({ error: error.message });
    return;
  }

  console.error("unexpected error:", error);
  response.status(500).json({ error: "Something went wrong on the server." });
});

async function start(): Promise<void> {
  console.log("--- BloodLink API starting ---");
  console.log(describeConfig());

  await connectToDatabase();
  console.log("connected to MongoDB");

  startRequestWatcher(io);

  // Without this handler, a port clash crashes with a stack trace instead of
  // telling you what to do about it.
  httpServer.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use. Close the other terminal running the API, or set PORT in server/.env.`);
      process.exit(1);
    }
    throw error;
  });

  // Listening on every interface, which is what a host like Render requires.
  httpServer.listen(PORT, () => {
    console.log(`BloodLink API listening on port ${PORT}`);
    if (!IS_PRODUCTION) console.log(`try it: http://localhost:${PORT}/api/health`);
  });
}

/**
 * Graceful shutdown.
 *
 * Render stops a service by sending SIGTERM and then waits a short while before
 * killing the process. Using that window to close the change stream and the
 * MongoDB client means Atlas is not left holding a dead cursor, and an
 * in-flight request gets to finish instead of failing halfway.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);

  // If something hangs, exit anyway rather than being killed mid-write.
  const forceExit = setTimeout(() => {
    console.error("shutdown took too long, exiting now");
    process.exit(1);
  }, 10000);
  forceExit.unref();

  try {
    await stopRequestWatcher();
    console.log("change stream closed");

    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    console.log("http server closed");

    await closeDatabase();
    console.log("MongoDB connection closed");
  } catch (error) {
    console.error("error while shutting down:", error);
  }

  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

start().catch((error) => {
  console.error("failed to start the server:", error instanceof Error ? error.message : error);
  console.error(
    "Check MONGO_URI, and that Atlas allows this server's IP address under Network Access " +
      "(0.0.0.0/0 for Render, because its free instances have no fixed IP)."
  );
  process.exit(1);
});
