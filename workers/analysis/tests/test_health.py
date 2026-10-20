from fastapi.testclient import TestClient

from analysis import __version__
from analysis.app import app

client = TestClient(app)


def test_health_ok() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_version_exposed() -> None:
    assert app.version == __version__
