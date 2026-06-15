"""
Shared pytest fixtures.

The app is created via the production create_app() factory with testing=True.
A DB mock is patched onto config.db._db so no real MongoDB is needed.
"""

import os
import pytest

# Must be set before any application module is imported.
os.environ.setdefault("JWT_SECRET", "test-secret-key-for-pytest")
os.environ.setdefault("MONGO_URI", "mongodb://localhost:27017/bank-test")
# Tell app.py NOT to connect to MongoDB or start background jobs on import.
os.environ["FLASK_TESTING"] = "1"


def _mock_db():
    """Minimal in-memory mock of a PyMongo database."""

    class _Cursor:
        def sort(self, *a, **k): return self
        def skip(self, *a, **k): return self
        def limit(self, *a, **k): return self
        def __iter__(self): return iter([])
        def __len__(self): return 0

    class _Col:
        def find_one(self, *a, **k): return None
        def find(self, *a, **k): return _Cursor()
        def count_documents(self, *a, **k): return 0
        def insert_one(self, doc, *a, **k):
            class _R:
                inserted_id = "mock-id"
            return _R()
        def update_one(self, *a, **k):
            class _R:
                matched_count = 0
                modified_count = 0
            return _R()
        def delete_many(self, *a, **k):
            class _R:
                deleted_count = 0
            return _R()
        def create_index(self, *a, **k): pass

    class _MockDB:
        def __getitem__(self, name): return _Col()
        def __getattr__(self, name): return _Col()

    return _MockDB()


@pytest.fixture(autouse=True)
def patch_db(monkeypatch):
    """Install the mock DB for every test automatically."""
    import config.db as db_module
    db_module._db = _mock_db()
    yield
    db_module._db = None


@pytest.fixture
def client(patch_db):
    """
    Flask test client built from the production app factory.
    Uses the mock DB injected by patch_db.
    """
    from app import create_app
    flask_app = create_app(testing=True)

    with flask_app.test_client() as c:
        yield c
