package com.example.app;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

class AppTest {
  private record Result(int code, String out, String err) {}

  private static Result exec(String... args) {
    var out = new StringBuilder();
    var err = new StringBuilder();
    int code = App.run(List.of(args), out, err);
    return new Result(code, out.toString(), err.toString());
  }

  @Test
  void greetsByName() {
    assertEquals("Hello, Ada!", Greeting.forName("Ada"));
    assertEquals("Hello, world!", Greeting.forName(" "));
  }

  @Test
  void printsGreetingAndExitsZero() {
    assertEquals(new Result(0, "Hello, Ada!\n", ""), exec("Ada"));
    assertEquals(new Result(0, "Hello, world!\n", ""), exec());
  }

  @Test
  void helpGoesToStdout() {
    assertEquals(new Result(0, "usage: app [--help] [NAME]\n", ""), exec("--help"));
  }

  @Test
  void badArgumentsFailOnStderr() {
    var r = exec("--nope");
    assertEquals(2, r.code());
    assertEquals("", r.out());
    assertTrue(r.err().startsWith("app: unknown option --nope"));
    assertEquals(2, exec("a", "b").code());
  }
}
