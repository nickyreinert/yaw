package com.example.app;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class RoutesTest {
  @Test
  void greetsByName() {
    assertEquals("Hello, Ada!", Greeting.forName("Ada"));
    assertEquals("Hello, world!", Greeting.forName(" "));
  }

  @Test
  void healthIsOk() {
    assertEquals(new Routes.Response(200, "ok"), Routes.handle("GET", "/health"));
  }

  @Test
  void rootGreetsTheWorld() {
    assertEquals(new Routes.Response(200, "Hello, world!"), Routes.handle("GET", "/"));
  }

  @Test
  void helloGreetsByName() {
    assertEquals(new Routes.Response(200, "Hello, Ada!"), Routes.handle("GET", "/hello/Ada"));
  }

  @Test
  void overlongNameIsRejected() {
    assertEquals(400, Routes.handle("GET", "/hello/" + "x".repeat(101)).status());
  }

  @Test
  void unknownPathIsNotFound() {
    assertEquals(404, Routes.handle("GET", "/nope").status());
    assertEquals(404, Routes.handle("GET", "/hello/a/b").status());
  }

  @Test
  void otherMethodsAreRejected() {
    assertEquals(405, Routes.handle("POST", "/health").status());
  }
}
