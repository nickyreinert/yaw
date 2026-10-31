package com.example.app;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

/**
 * Thin entry point: reads HOST (default 127.0.0.1) and PORT (default 8080); the platform sets PORT.
 */
public final class Server {
  private Server() {}

  public static void main(String[] args) throws IOException {
    var host = System.getenv().getOrDefault("HOST", "127.0.0.1");
    var port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));
    var server = HttpServer.create(new InetSocketAddress(host, port), 0);
    server.createContext("/", Server::serve);
    // SIGTERM: stop accepting, finish running requests for up to 5 seconds.
    Runtime.getRuntime().addShutdownHook(new Thread(() -> server.stop(5)));
    server.start();
    System.out.println("listening on http://" + host + ":" + port);
  }

  private static void serve(HttpExchange exchange) throws IOException {
    try (exchange) {
      var response = Routes.handle(exchange.getRequestMethod(), exchange.getRequestURI().getPath());
      var bytes = response.body().getBytes(StandardCharsets.UTF_8);
      exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
      exchange.sendResponseHeaders(response.status(), bytes.length);
      exchange.getResponseBody().write(bytes);
    }
  }
}
