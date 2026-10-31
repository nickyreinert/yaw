package com.example.app;

import java.util.List;

/** The command; results go to {@code out}, errors to {@code err}. Returns the exit code. */
public final class App {
  private static final String USAGE = "usage: app [--help] [NAME]";

  private App() {}

  public static int run(List<String> args, Appendable out, Appendable err) {
    try {
      if (args.contains("--help") || args.contains("-h")) {
        out.append(USAGE).append('\n');
        return 0;
      }
      var option = args.stream().filter(a -> a.startsWith("-")).findFirst();
      if (option.isPresent()) {
        err.append("app: unknown option ")
            .append(option.get())
            .append('\n')
            .append(USAGE)
            .append('\n');
        return 2;
      }
      if (args.size() > 1) {
        err.append("app: expected at most one NAME\n").append(USAGE).append('\n');
        return 2;
      }
      out.append(Greeting.forName(args.isEmpty() ? "" : args.get(0))).append('\n');
      return 0;
    } catch (java.io.IOException e) {
      return 1;
    }
  }
}
