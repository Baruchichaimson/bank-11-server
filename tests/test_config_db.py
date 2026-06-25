import pytest
from pymongo.errors import ConnectionFailure


@pytest.mark.unit
def test_connect_mongodb_prints_helpful_error_and_exits(monkeypatch, capsys):
    import config.db as db_module

    class FakeAdmin:
        def command(self, _name):
            raise ConnectionFailure("boom")

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.admin = FakeAdmin()

    monkeypatch.setattr(db_module, "MongoClient", FakeClient)
    monkeypatch.setattr(db_module, "MONGO_URI", "mongodb://example.invalid/bank-test")

    try:
        with pytest.raises(SystemExit) as excinfo:
            db_module.connect_mongodb()
    finally:
        db_module._client = None
        db_module._db = None

    assert excinfo.value.code == 1
    captured = capsys.readouterr()
    assert "MongoDB connection error" in captured.err
    assert "Current URI: mongodb://example.invalid/bank-test" in captured.err
