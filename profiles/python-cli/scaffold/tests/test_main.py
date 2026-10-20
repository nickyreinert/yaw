from app.main import greet


def test_greet_names_the_person() -> None:
    assert greet("YAW") == "Hello, YAW!"
