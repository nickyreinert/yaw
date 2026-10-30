import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from _greeting import greeting


class handler(BaseHTTPRequestHandler):  # Vercel looks for this exact class name
    def do_GET(self) -> None:
        name = parse_qs(urlparse(self.path).query).get("name", [""])[0]
        body = json.dumps({"message": greeting(name)}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
