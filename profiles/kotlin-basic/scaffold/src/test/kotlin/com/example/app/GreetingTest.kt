package com.example.app

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class GreetingTest {
    @Test
    fun greetsByName() {
        assertEquals("Hello, Ada!", greeting("Ada"))
    }
}
