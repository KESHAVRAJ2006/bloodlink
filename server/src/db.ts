import { MongoClient, type Collection, type Db } from "mongodb";
import { DB_NAME, MONGO_URI } from "./config.js";
import type { BloodRequest, CityZone, Donation, Donor, Hospital } from "./types.js";

// One client for the whole process. The driver keeps its own connection pool,
// so opening a client per request would be wasteful and slow.
//
// ignoreUndefined matters more than it looks: by default the driver writes an
// undefined field as null, and a null email or note then fails the $jsonSchema
// validator which expects a string. With this option an optional field that was
// left out is simply not stored.
export const client = new MongoClient(MONGO_URI, {
  serverSelectionTimeoutMS: 10000,
  ignoreUndefined: true,
});

let database: Db | null = null;

export async function connectToDatabase(): Promise<Db> {
  if (database) return database;

  await client.connect();
  database = client.db(DB_NAME);
  await database.command({ ping: 1 });
  return database;
}

function getDatabase(): Db {
  if (!database) {
    throw new Error("connectToDatabase() must be awaited before using a collection.");
  }
  return database;
}

/**
 * Used by /api/health. Returns false instead of throwing, because the health
 * endpoint has to answer even when the database is unreachable.
 */
export async function isDatabaseReachable(): Promise<boolean> {
  try {
    await client.db(DB_NAME).command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

// Typed accessors, so every route gets autocomplete on the document shape.
export const donors = (): Collection<Donor> => getDatabase().collection<Donor>("donors");
export const hospitals = (): Collection<Hospital> => getDatabase().collection<Hospital>("hospitals");
export const requests = (): Collection<BloodRequest> => getDatabase().collection<BloodRequest>("requests");
export const donations = (): Collection<Donation> => getDatabase().collection<Donation>("donations");
export const cityZones = (): Collection<CityZone> => getDatabase().collection<CityZone>("cityZones");

export async function closeDatabase(): Promise<void> {
  await client.close();
  database = null;
}
