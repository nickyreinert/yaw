package com.example.app;

/** Routes of the service as a pure function; tests call it without a socket. */
public final class Routes {
  private static final int MAX_NAME = 100;

  public record Response(int status, String body) {}

  private Routes() {}

  public static Response handle(String method, String rawPath) {
    if (!"GET".equals(method)) {
      return new Response(405, "method not allowed");
    }
    var path = rawPath == null ? "" : rawPath.replaceAll("^/+|/+$", "");
    if (path.isEmpty()) {
      return new Response(200, Greeting.forName(""));
    }
    if (path.equals("health")) {
      return new Response(200, "ok");
    }
    if (path.startsWith("hello/") && path.indexOf('/', 6) < 0) {
      var name = path.substring(6);
      return name.length() > MAX_NAME
          ? new Response(400, "name too long")
          : new Response(200, Greeting.forName(name));
    }
    return new Response(404, "not found");
  }
}
