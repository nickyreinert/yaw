package com.example.app

import com.amazonaws.services.lambda.runtime.events.APIGatewayV2HTTPEvent
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class HandlerTest {
    private fun call(path: String): Pair<Int, String> {
        val event = APIGatewayV2HTTPEvent.builder().withRawPath(path).build()
        val response = Handler().handleRequest(event, null)
        return response.statusCode to response.body
    }

    @Test
    fun greetsByName() {
        assertEquals("Hello, Ada!", greeting("Ada"))
        assertEquals("Hello, world!", greeting(" "))
    }

    @Test
    fun healthIsOk() {
        assertEquals(200 to "ok", call("/health"))
    }

    @Test
    fun rootGreetsTheWorld() {
        assertEquals(200 to "Hello, world!", call("/"))
    }

    @Test
    fun helloGreetsByName() {
        assertEquals(200 to "Hello, Ada!", call("/hello/Ada"))
    }

    @Test
    fun overlongNameIsRejected() {
        assertEquals(400, call("/hello/${"x".repeat(101)}").first)
    }

    @Test
    fun unknownPathIsNotFound() {
        assertEquals(404, call("/nope").first)
        assertEquals(404, call("/hello/a/b").first)
    }
}
