package com.example.app;

import java.util.List;

public final class Main {
  private Main() {}

  public static void main(String[] args) {
    System.exit(App.run(List.of(args), System.out, System.err));
  }
}
