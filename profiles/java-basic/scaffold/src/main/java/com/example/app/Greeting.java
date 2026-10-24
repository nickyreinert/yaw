package com.example.app;

public final class Greeting {
    private Greeting() {}

    public static String forName(String name) {
        return "Hello, " + (name == null || name.isBlank() ? "world" : name) + "!";
    }
}
