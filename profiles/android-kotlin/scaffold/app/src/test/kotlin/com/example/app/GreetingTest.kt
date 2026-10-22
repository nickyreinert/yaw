package com.example.app

import org.junit.Assert.assertEquals
import org.junit.Test

class GreetingTest {
    @Test
    fun greetsByName() {
        assertEquals("Hello, Ada!", greeting("Ada"))
    }

    @Test
    fun greetsTheWorldWithoutAName() {
        assertEquals("Hello, world!", greeting(""))
        assertEquals("Hello, world!", greeting("  "))
    }
}
