package com.example.app

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class AppTest {
    private fun exec(vararg args: String): Triple<Int, String, String> {
        val out = StringBuilder()
        val err = StringBuilder()
        val code = run(args.toList(), out, err)
        return Triple(code, out.toString(), err.toString())
    }

    @Test
    fun greetsByName() {
        assertEquals("Hello, Ada!", greeting("Ada"))
        assertEquals("Hello, world!", greeting(" "))
    }

    @Test
    fun printsGreetingAndExitsZero() {
        assertEquals(Triple(0, "Hello, Ada!\n", ""), exec("Ada"))
        assertEquals(Triple(0, "Hello, world!\n", ""), exec())
    }

    @Test
    fun helpGoesToStdout() {
        val (code, out, err) = exec("--help")
        assertEquals(0, code)
        assertEquals("usage: app [--help] [NAME]\n", out)
        assertEquals("", err)
    }

    @Test
    fun badArgumentsFailOnStderr() {
        val (code, out, err) = exec("--nope")
        assertEquals(2, code)
        assertEquals("", out)
        assertEquals(true, err.startsWith("app: unknown option --nope"))
        assertEquals(2, exec("a", "b").first)
    }
}
