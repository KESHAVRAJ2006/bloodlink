"""
BloodLink data seeder.

Fills the bloodlink database with realistic demo data: 500 donors spread around
Mysuru, Mandya and Bengaluru, a donation history for most of them, and a set of
blood requests raised by the hospitals that database/setup.js inserted.

Usage (from the seeder folder, with the virtual environment active):

    python seed.py              # add data, keep what is already there
    python seed.py --reset      # delete donors, donations, requests first
    python seed.py --donors 200 # seed a different number of donors

database/setup.js must be run first, because this script reads the hospitals
and city zones it created and relies on the schema validators and indexes.
"""

import argparse
import os
import random
import sys
from datetime import datetime, timedelta, timezone

import bcrypt
from dotenv import load_dotenv
from faker import Faker
from pymongo import MongoClient, UpdateOne
from pymongo.errors import BulkWriteError, ServerSelectionTimeoutError

# Every seeded donor gets the same password so any of them can be used to test
# the login page. The hash is computed once and reused, because bcrypt is slow
# on purpose and 500 separate hashes would take several seconds.
DEMO_PASSWORD = "demo1234"

# Blood group distribution in India, rounded to whole percentages. O+ and B+ are
# by far the most common, AB- the rarest.
BLOOD_GROUP_WEIGHTS = {
    "O+": 28,
    "B+": 32,
    "A+": 21,
    "AB+": 8,
    "O-": 3,
    "B-": 3,
    "A-": 3,
    "AB-": 2,
}

# Each city gets a centre and a jitter in degrees. The jitter is kept small
# enough that every generated point still falls inside the matching cityZones
# polygon, so the $geoWithin demo returns sensible numbers.
# 0.01 degree is roughly 1.1 km.
CITIES = [
    {"name": "Mysuru", "lng": 76.6394, "lat": 12.2958, "jitter": 0.050, "share": 0.40},
    {"name": "Mandya", "lng": 76.8958, "lat": 12.5218, "jitter": 0.040, "share": 0.20},
    {"name": "Bengaluru", "lng": 77.5946, "lat": 12.9716, "jitter": 0.070, "share": 0.40},
]

DONOR_BATCH_SIZE = 100

fake = Faker("en_IN")

DEMO_PASSWORD_HASH = bcrypt.hashpw(DEMO_PASSWORD.encode(), bcrypt.gensalt(rounds=10)).decode()


def now_utc():
    """Timezone aware current time. pymongo stores it as a BSON date."""
    return datetime.now(timezone.utc)


def pick_city():
    """Pick a city using the shares above."""
    return random.choices(CITIES, weights=[city["share"] for city in CITIES], k=1)[0]


def pick_blood_group():
    groups = list(BLOOD_GROUP_WEIGHTS.keys())
    weights = list(BLOOD_GROUP_WEIGHTS.values())
    return random.choices(groups, weights=weights, k=1)[0]


def random_point(city):
    """A GeoJSON point near the city centre. Order is [longitude, latitude]."""
    lng = city["lng"] + random.uniform(-city["jitter"], city["jitter"])
    lat = city["lat"] + random.uniform(-city["jitter"], city["jitter"])
    return {"type": "Point", "coordinates": [round(lng, 6), round(lat, 6)]}


def random_phone(used):
    """A 10 digit Indian mobile number that no other donor has."""
    while True:
        number = str(random.choice([6, 7, 8, 9])) + "".join(
            str(random.randint(0, 9)) for _ in range(9)
        )
        if number not in used:
            used.add(number)
            return number


def random_age():
    """Donors are 18 to 65, with more of them in their twenties and thirties."""
    bracket = random.choices(
        [(18, 25), (26, 35), (36, 45), (46, 65)], weights=[30, 35, 20, 15], k=1
    )[0]
    return random.randint(bracket[0], bracket[1])


def build_donor(used_phones):
    gender = random.choices(["male", "female", "other"], weights=[52, 46, 2], k=1)[0]
    if gender == "female":
        name = fake.name_female()
    else:
        name = fake.name_male()

    city = pick_city()
    phone = random_phone(used_phones)
    email = "{}.{}@example.com".format(
        name.split()[0].lower().strip("."), phone[-4:]
    )

    return {
        "name": name,
        "phone": phone,
        "email": email,
        # Every seeded donor shares the same demo password, see README.
        "passwordHash": DEMO_PASSWORD_HASH,
        "bloodGroup": pick_blood_group(),
        "age": random_age(),
        "gender": gender,
        "city": city["name"],
        "location": random_point(city),
        "lastDonation": None,
        "available": random.random() < 0.80,
        "donationCount": 0,
        "registeredOn": now_utc() - timedelta(days=random.randint(0, 540)),
    }


def seed_donors(donors_collection, count):
    """Insert donors in batches and return the ids that were created."""
    used_phones = set(donors_collection.distinct("phone"))
    inserted_ids = []

    batch = []
    for index in range(count):
        batch.append(build_donor(used_phones))
        if len(batch) == DONOR_BATCH_SIZE or index == count - 1:
            try:
                result = donors_collection.insert_many(batch, ordered=False)
                inserted_ids.extend(result.inserted_ids)
            except BulkWriteError as error:
                # A duplicate phone number is the only expected failure here and
                # it is not worth stopping the whole run for.
                print("  some donors were skipped:", error.details.get("nInserted"))
            print("  donors inserted: {}/{}".format(len(inserted_ids), count))
            batch = []

    return inserted_ids


def seed_donations(donations_collection, donors_collection, donor_ids, hospitals):
    """
    Give about two thirds of the donors a donation history, then update each of
    those donors so lastDonation and donationCount match the donations table.
    """
    donations = []
    donor_updates = []

    for donor_id in donor_ids:
        if random.random() > 0.65:
            continue

        donation_count = random.choices([1, 2, 3, 4, 5], weights=[40, 28, 17, 10, 5], k=1)[0]
        # Spread the donations over the last two years, newest first.
        days_ago = sorted(random.sample(range(5, 730), donation_count))
        dates = [now_utc() - timedelta(days=day) for day in days_ago]

        for date in dates:
            hospital = random.choice(hospitals)
            donations.append(
                {
                    "donorId": donor_id,
                    "hospitalId": hospital["_id"],
                    "requestId": None,
                    "date": date,
                    "units": random.choices([1, 2], weights=[85, 15], k=1)[0],
                }
            )

        last_donation = max(dates)
        donor_updates.append(
            UpdateOne(
                {"_id": donor_id},
                {
                    "$set": {"lastDonation": last_donation},
                    "$inc": {"donationCount": donation_count},
                },
            )
        )

    if donations:
        donations_collection.insert_many(donations, ordered=False)
    if donor_updates:
        donors_collection.bulk_write(donor_updates, ordered=False)

    return len(donations), len(donor_updates)


def seed_requests(requests_collection, hospitals):
    """
    Create a handful of blood requests. Open requests always expire in the
    future, otherwise the TTL index would delete them within a minute.
    """
    requests = []

    # Open requests - these are what the Requests page and the dashboard show.
    for _ in range(14):
        hospital = random.choice(hospitals)
        urgency = random.choices(["normal", "urgent", "critical"], weights=[45, 35, 20], k=1)[0]
        created_at = now_utc() - timedelta(hours=random.randint(0, 60))
        requests.append(
            {
                "hospitalId": hospital["_id"],
                "patientName": fake.name(),
                "bloodGroup": pick_blood_group(),
                "unitsNeeded": random.randint(1, 4),
                "urgency": urgency,
                "status": "open",
                "createdAt": created_at,
                "expiresAt": now_utc() + timedelta(hours=random.randint(8, 96)),
            }
        )

    # A few closed requests so the dashboard is not all open.
    for status in ["fulfilled"] * 6 + ["cancelled"] * 3:
        hospital = random.choice(hospitals)
        created_at = now_utc() - timedelta(days=random.randint(1, 20))
        request = {
            "hospitalId": hospital["_id"],
            "patientName": fake.name(),
            "bloodGroup": pick_blood_group(),
            "unitsNeeded": random.randint(1, 3),
            "urgency": random.choice(["normal", "urgent", "critical"]),
            "status": status,
            "createdAt": created_at,
            "expiresAt": now_utc() + timedelta(days=random.randint(10, 40)),
        }
        if status == "fulfilled":
            request["fulfilledAt"] = created_at + timedelta(hours=random.randint(1, 20))
        requests.append(request)

    requests_collection.insert_many(requests, ordered=False)
    return len(requests)


def print_summary(database):
    print("")
    print("--- database summary ---")
    for name in ["donors", "hospitals", "requests", "donations", "cityZones"]:
        print("  {:<10} {}".format(name, database[name].count_documents({})))

    print("")
    print("donors per blood group:")
    pipeline = [
        {"$group": {"_id": "$bloodGroup", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    for row in database["donors"].aggregate(pipeline):
        print("  {:<4} {}".format(row["_id"], row["count"]))

    print("")
    print("donors per city:")
    pipeline = [
        {"$group": {"_id": "$city", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    for row in database["donors"].aggregate(pipeline):
        print("  {:<10} {}".format(row["_id"], row["count"]))


def main():
    parser = argparse.ArgumentParser(description="Seed the BloodLink database.")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="delete donors, donations and requests before seeding",
    )
    parser.add_argument(
        "--donors", type=int, default=500, help="number of donors to create (default 500)"
    )
    parser.add_argument("--seed", type=int, help="random seed, for repeatable data")
    arguments = parser.parse_args()

    if arguments.seed is not None:
        random.seed(arguments.seed)
        Faker.seed(arguments.seed)

    load_dotenv()
    # MONGO_URI is the name used by the server and by Render; MONGODB_URI is
    # still accepted so an older .env file keeps working.
    uri = os.getenv("MONGO_URI") or os.getenv("MONGODB_URI")
    if not uri:
        sys.exit(
            "MONGO_URI is not set. Copy .env.example to .env, paste your Atlas "
            "connection string, and run this from inside the seeder folder."
        )

    database_name = os.getenv("DB_NAME", "bloodlink")
    client = MongoClient(uri, serverSelectionTimeoutMS=10000)

    try:
        client.admin.command("ping")
    except ServerSelectionTimeoutError:
        sys.exit(
            "Could not reach MongoDB. Check the connection string and that your "
            "current IP address is allowed in Atlas under Network Access."
        )

    database = client[database_name]
    print("connected to", database_name)

    hospitals = list(database["hospitals"].find({}, {"_id": 1, "name": 1, "city": 1}))
    if not hospitals:
        sys.exit(
            "No hospitals found. Run database/setup.js with mongosh before seeding."
        )
    if database["cityZones"].count_documents({}) == 0:
        sys.exit("No city zones found. Run database/setup.js with mongosh before seeding.")

    if arguments.reset:
        print("resetting donors, donations and requests")
        database["donors"].delete_many({})
        database["donations"].delete_many({})
        database["requests"].delete_many({})

    print("seeding {} donors".format(arguments.donors))
    donor_ids = seed_donors(database["donors"], arguments.donors)

    print("seeding donation history")
    donations, donors_updated = seed_donations(
        database["donations"], database["donors"], donor_ids, hospitals
    )
    print("  {} donations for {} donors".format(donations, donors_updated))

    print("seeding blood requests")
    created = seed_requests(database["requests"], hospitals)
    print("  {} requests".format(created))

    print_summary(database)
    client.close()

    print("")
    print("Done. Every seeded donor can log in with the password: demo1234")


if __name__ == "__main__":
    main()
