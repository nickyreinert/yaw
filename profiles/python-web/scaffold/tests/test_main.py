from fastapi.testclient import TestClient

from app.main import app, greet

client = TestClient(app)


def test_greet_names_the_person() -> None:
    assert greet("YAW") == "Hello, YAW!"


def test_health_is_ok() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_hello_greets_by_name() -> None:
    assert client.get("/hello/YAW").json() == {"message": "Hello, YAW!"}
