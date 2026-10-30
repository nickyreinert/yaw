import json
import threading
from http.server import HTTPServer
from urllib.request import urlopen

from _greeting import greeting
from hello import handler


def test_greeting_names_the_person() -> None:
    assert greeting("Ada") == "Hello, Ada!"


def test_greeting_defaults_to_world() -> None:
    assert greeting("") == "Hello, world!"


def test_handler_answers_with_json() -> None:
    server = HTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with urlopen(f"http://127.0.0.1:{server.server_port}/api/hello?name=YAW") as response:
            assert response.status == 200
            assert json.load(response) == {"message": "Hello, YAW!"}
    finally:
        server.shutdown()
        server.server_close()
