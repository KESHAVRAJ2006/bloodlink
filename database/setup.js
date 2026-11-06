/*
 * BloodLink - database setup script
 * Run with:  mongosh "<ATLAS_URI>" database/setup.js
 *
 * Creates the five collections with schema validation, builds every index the
 * application needs (2dsphere, compound, unique, TTL) and inserts the reference
 * data that rarely changes: hospitals and city zone polygons.
 *
 * Safe to run more than once - collection creation is skipped when the
 * collection already exists, and reference data is upserted by name instead of
 * blindly inserted.
 */

const bloodlink = db.getSiblingDB("bloodlink");

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

// A GeoJSON Point sub-schema, reused by donors and hospitals.
const pointSchema = {
  bsonType: "object",
  required: ["type", "coordinates"],
  properties: {
    type: { enum: ["Point"], description: "must be the string Point" },
    coordinates: {
      bsonType: "array",
      minItems: 2,
      maxItems: 2,
      items: { bsonType: "number" },
      description: "must be [longitude, latitude] in that order"
    }
  }
};

// createCollection throws when the collection is already there, so in that case
// we run collMod instead to keep the validator up to date.
function createOrUpdate(name, options) {
  const existing = bloodlink.getCollectionNames();
  if (existing.indexOf(name) === -1) {
    bloodlink.createCollection(name, options);
    print("created collection: " + name);
  } else if (options && options.validator) {
    bloodlink.runCommand({
      collMod: name,
      validator: options.validator,
      validationLevel: "strict",
      validationAction: "error"
    });
    print("updated validator on existing collection: " + name);
  } else {
    print("collection already exists: " + name);
  }
}

/* ------------------------------------------------------------------ donors */

createOrUpdate("donors", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["name", "phone", "bloodGroup", "age", "city", "location", "available"],
      properties: {
        name: { bsonType: "string", minLength: 2 },
        phone: {
          bsonType: "string",
          pattern: "^[6-9][0-9]{9}$",
          description: "10 digit Indian mobile number"
        },
        email: { bsonType: "string" },
        passwordHash: { bsonType: "string" },
        bloodGroup: { enum: BLOOD_GROUPS },
        age: { bsonType: "number", minimum: 18, maximum: 65 },
        gender: { enum: ["male", "female", "other"] },
        city: { bsonType: "string" },
        location: pointSchema,
        lastDonation: { bsonType: ["date", "null"] },
        available: { bsonType: "bool" },
        donationCount: { bsonType: "number", minimum: 0 },
        registeredOn: { bsonType: "date" }
      }
    }
  },
  validationAction: "error"
});

// 2dsphere powers $near / $geoNear / $geoWithin on a sphere.
bloodlink.donors.createIndex({ location: "2dsphere" }, { name: "location_2dsphere" });
// The nearby search filters on these two fields together, so one compound index
// serves it better than two single-field indexes.
bloodlink.donors.createIndex({ bloodGroup: 1, available: 1 }, { name: "bloodGroup_available" });
// One account per mobile number.
bloodlink.donors.createIndex({ phone: 1 }, { unique: true, name: "phone_unique" });

/* --------------------------------------------------------------- hospitals */

createOrUpdate("hospitals", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["name", "city", "location"],
      properties: {
        name: { bsonType: "string", minLength: 3 },
        address: { bsonType: "string" },
        city: { bsonType: "string" },
        phone: { bsonType: "string" },
        location: pointSchema
      }
    }
  }
});

bloodlink.hospitals.createIndex({ location: "2dsphere" }, { name: "location_2dsphere" });
bloodlink.hospitals.createIndex({ name: 1 }, { unique: true, name: "name_unique" });

/* ---------------------------------------------------------------- requests */

createOrUpdate("requests", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["hospitalId", "patientName", "bloodGroup", "unitsNeeded", "urgency", "status", "createdAt", "expiresAt"],
      properties: {
        hospitalId: { bsonType: "objectId" },
        patientName: { bsonType: "string", minLength: 2 },
        bloodGroup: { enum: BLOOD_GROUPS },
        unitsNeeded: { bsonType: "number", minimum: 1, maximum: 20 },
        urgency: { enum: ["normal", "urgent", "critical"] },
        status: { enum: ["open", "fulfilled", "cancelled"] },
        createdAt: { bsonType: "date" },
        expiresAt: { bsonType: "date" },
        fulfilledAt: { bsonType: ["date", "null"] },
        note: { bsonType: "string" }
      }
    }
  }
});

// TTL index: MongoDB removes the document once expiresAt is in the past.
// expireAfterSeconds: 0 means "expire exactly at the stored date".
bloodlink.requests.createIndex(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "expiresAt_ttl" }
);
bloodlink.requests.createIndex({ status: 1, urgency: 1 }, { name: "status_urgency" });
bloodlink.requests.createIndex({ bloodGroup: 1, status: 1 }, { name: "bloodGroup_status" });

/* --------------------------------------------------------------- donations */

createOrUpdate("donations", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["donorId", "hospitalId", "date", "units"],
      properties: {
        donorId: { bsonType: "objectId" },
        hospitalId: { bsonType: "objectId" },
        requestId: { bsonType: ["objectId", "null"] },
        date: { bsonType: "date" },
        units: { bsonType: "number", minimum: 1, maximum: 4 }
      }
    }
  }
});

bloodlink.donations.createIndex({ donorId: 1, date: -1 }, { name: "donorId_date" });
bloodlink.donations.createIndex({ hospitalId: 1 }, { name: "hospitalId" });

/* --------------------------------------------------------------- cityZones */

createOrUpdate("cityZones", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["name", "area"],
      properties: {
        name: { bsonType: "string" },
        district: { bsonType: "string" },
        area: {
          bsonType: "object",
          required: ["type", "coordinates"],
          properties: {
            type: { enum: ["Polygon"] },
            coordinates: { bsonType: "array" }
          }
        }
      }
    }
  }
});

bloodlink.cityZones.createIndex({ area: "2dsphere" }, { name: "area_2dsphere" });
bloodlink.cityZones.createIndex({ name: 1 }, { unique: true, name: "name_unique" });

/* ----------------------------------------------------- reference: hospitals */
// Real hospital names with approximate coordinates taken from the map.

const hospitals = [
  // Mysuru
  { name: "K. R. Hospital (Mysore Medical College)", address: "Irwin Road, Mysuru", city: "Mysuru", phone: "08212429501", location: { type: "Point", coordinates: [76.6497, 12.3072] } },
  { name: "JSS Hospital", address: "Ramanuja Road, Mysuru", city: "Mysuru", phone: "08212548000", location: { type: "Point", coordinates: [76.6413, 12.3076] } },
  { name: "Apollo BGS Hospital", address: "Adichunchanagiri Road, Kuvempunagar, Mysuru", city: "Mysuru", phone: "08212568888", location: { type: "Point", coordinates: [76.6163, 12.2843] } },
  { name: "Columbia Asia Hospital Mysore", address: "Hebbal Industrial Area, Mysuru", city: "Mysuru", phone: "08216655000", location: { type: "Point", coordinates: [76.6186, 12.3391] } },
  // Mandya
  { name: "Mandya Institute of Medical Sciences Hospital", address: "Bengaluru-Mysuru Road, Mandya", city: "Mandya", phone: "08232220015", location: { type: "Point", coordinates: [76.8953, 12.5236] } },
  { name: "District Government Hospital Mandya", address: "Hospital Road, Mandya", city: "Mandya", phone: "08232222200", location: { type: "Point", coordinates: [76.8972, 12.5281] } },
  { name: "Mandya City Blood Centre", address: "M. C. Road, Mandya", city: "Mandya", phone: "08232225566", location: { type: "Point", coordinates: [76.8886, 12.5190] } },
  // Bengaluru
  { name: "Victoria Hospital", address: "Fort Road, Kalasipalya, Bengaluru", city: "Bengaluru", phone: "08026701150", location: { type: "Point", coordinates: [77.5747, 12.9627] } },
  { name: "Bowring and Lady Curzon Hospital", address: "Shivaji Nagar, Bengaluru", city: "Bengaluru", phone: "08025591362", location: { type: "Point", coordinates: [77.6035, 12.9826] } },
  { name: "St. Johns Medical College Hospital", address: "Sarjapur Road, Koramangala, Bengaluru", city: "Bengaluru", phone: "08022065000", location: { type: "Point", coordinates: [77.6202, 12.9279] } },
  { name: "Manipal Hospital Old Airport Road", address: "98 HAL Old Airport Road, Bengaluru", city: "Bengaluru", phone: "08025024444", location: { type: "Point", coordinates: [77.6487, 12.9591] } },
  { name: "Mallya Hospital", address: "Vittal Mallya Road, Bengaluru", city: "Bengaluru", phone: "08022277979", location: { type: "Point", coordinates: [77.5959, 12.9697] } },
  { name: "Sri Jayadeva Institute of Cardiovascular Sciences", address: "9th Block, Jayanagar, Bengaluru", city: "Bengaluru", phone: "08022977400", location: { type: "Point", coordinates: [77.5837, 12.9185] } }
];

hospitals.forEach(function (hospital) {
  bloodlink.hospitals.replaceOne({ name: hospital.name }, hospital, { upsert: true });
});
print("hospitals in database: " + bloodlink.hospitals.countDocuments());

/* ----------------------------------------------------- reference: cityZones */

// Simple rectangles around each city, enough to demonstrate $geoWithin and
// $geoIntersects. A GeoJSON ring has to repeat its first point at the end, and
// is listed counter-clockwise so MongoDB treats the small side as the inside.
function rectangle(minLng, minLat, maxLng, maxLat) {
  return {
    type: "Polygon",
    coordinates: [[
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat]
    ]]
  };
}

const cityZones = [
  { name: "Mysuru", district: "Mysuru", area: rectangle(76.55, 12.22, 76.75, 12.37) },
  { name: "Mandya", district: "Mandya", area: rectangle(76.83, 12.45, 76.98, 12.60) },
  { name: "Bengaluru", district: "Bengaluru Urban", area: rectangle(77.45, 12.85, 77.75, 13.05) }
];

cityZones.forEach(function (zone) {
  bloodlink.cityZones.replaceOne({ name: zone.name }, zone, { upsert: true });
});
print("city zones in database: " + bloodlink.cityZones.countDocuments());

/* ------------------------------------------------------------------ summary */

print("");
print("--- BloodLink setup finished ---");
bloodlink.getCollectionNames().sort().forEach(function (name) {
  const collection = bloodlink.getCollection(name);
  const indexNames = collection.getIndexes().map(function (index) { return index.name; });
  print(name + "  docs=" + collection.countDocuments() + "  indexes=[" + indexNames.join(", ") + "]");
});
print("");
print("Next step: run the Python seeder to create donors, donations and requests.");
