package com.example.app;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

final class GreetingTest {
    @Test
    void greetsByName() {
        assertEquals("Hello, Ada!", Greeting.forName("Ada"));
    }
}
