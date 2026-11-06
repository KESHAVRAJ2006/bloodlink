import type { Server as SocketServer } from "socket.io";
import type { ChangeStream, ChangeStreamInsertDocument } from "mongodb";
import { hospitals, requests } from "./db.js";
import type { BloodRequest } from "./types.js";

/**
 * Change stream watcher.
 *
 * Instead of the browser asking "any new requests?" every few seconds, MongoDB
 * tells us the moment a request document is inserted. We read that event from
 * the oplog through a change stream and push it to every connected browser over
 * Socket.IO, so a critical request appears on the Requests page immediately.
 *
 * Change streams only work on a replica set, which is what every Atlas cluster
 * is, including the free tier. They do not work on a single standalone mongod.
 */

let stream: ChangeStream<BloodRequest> | null = null;
let stopped = false;

const RETRY_DELAY_MS = 5000;

export function startRequestWatcher(io: SocketServer): void {
  stopped = false;
  watch(io);
}

function watch(io: SocketServer): void {
  // Only inserts are interesting here, and fullDocument gives us the whole new
  // request instead of just its id.
  stream = requests().watch<BloodRequest>([{ $match: { operationType: "insert" } }], {
    fullDocument: "updateLookup",
  });

  stream.on("change", async (change) => {
    const inserted = (change as ChangeStreamInsertDocument<BloodRequest>).fullDocument;
    if (!inserted) return;

    // The UI needs the hospital name, which lives in another collection.
    const hospital = await hospitals().findOne(
      { _id: inserted.hospitalId },
      { projection: { name: 1, city: 1, location: 1 } }
    );

    io.emit("new-request", {
      _id: inserted._id.toString(),
      patientName: inserted.patientName,
      bloodGroup: inserted.bloodGroup,
      unitsNeeded: inserted.unitsNeeded,
      urgency: inserted.urgency,
      status: inserted.status,
      createdAt: inserted.createdAt,
      expiresAt: inserted.expiresAt,
      hospital: hospital
        ? { _id: hospital._id.toString(), name: hospital.name, city: hospital.city, location: hospital.location }
        : null,
    });

    console.log(`change stream: new ${inserted.urgency} request for ${inserted.bloodGroup}`);
  });

  stream.on("error", (error) => {
    console.error("change stream error:", error.message);
    if (stopped) return;
    // A dropped connection should not take the API down with it, so close this
    // stream and open a fresh one after a short pause.
    void stream?.close().catch(() => undefined);
    setTimeout(() => {
      if (!stopped) watch(io);
    }, RETRY_DELAY_MS);
  });

  console.log("change stream: watching the requests collection");
}

export async function stopRequestWatcher(): Promise<void> {
  stopped = true;
  if (stream) {
    await stream.close().catch(() => undefined);
    stream = null;
  }
}
