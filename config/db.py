import sys
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, ConfigurationError
from config.settings import MONGO_URI

_client: MongoClient | None = None
_db = None


def connect_mongodb():
    global _client, _db
    try:
        _client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        _client.admin.command("ping")
        db_name = MONGO_URI.split("/")[-1].split("?")[0] or "bank-11"
        _db = _client[db_name]
        print("MongoDB connected successfully")
        return _db
    except ConnectionFailure as err:
        print(f"MongoDB connection error: {err}", file=sys.stderr)
        print(
            "MongoDB refused the connection. Ensure the database is running and accessible, "
            f"or update MONGO_URI. Current URI: {MONGO_URI}",
            file=sys.stderr,
        )
        sys.exit(1)
    except ConfigurationError as err:
        print(f"MongoDB configuration error: {err}", file=sys.stderr)
        sys.exit(1)
    except Exception as err:
        print(f"MongoDB connection error: {err}", file=sys.stderr)
        print(f"Check that the MONGO_URI is valid. Current URI: {MONGO_URI}", file=sys.stderr)
        sys.exit(1)


def get_db():
    global _db
    if _db is None:
        raise RuntimeError("Database not connected. Call connect_mongodb() first.")
    return _db
