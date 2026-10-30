package com.example.app

import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ApplicationTest {
    private fun get(path: String): Pair<HttpStatusCode, String> =
        runBlocking {
            var result: Pair<HttpStatusCode, String>? = null
            testApplication {
                application { module() }
                val response = client.get(path)
                result = response.status to response.bodyAsText()
            }
            checkNotNull(result)
        }

    @Test
    fun greetsByName() {
        assertEquals("Hello, Ada!", greeting("Ada"))
        assertEquals("Hello, world!", greeting(" "))
    }

    @Test
    fun healthIsOk() {
        assertEquals(HttpStatusCode.OK to "ok", get("/health"))
    }

    @Test
    fun rootGreetsTheWorld() {
        assertEquals(HttpStatusCode.OK to "Hello, world!", get("/"))
    }

    @Test
    fun helloGreetsByName() {
        assertEquals(HttpStatusCode.OK to "Hello, Ada!", get("/hello/Ada"))
    }

    @Test
    fun overlongNameIsRejected() {
        assertEquals(HttpStatusCode.BadRequest, get("/hello/${"x".repeat(101)}").first)
    }

    @Test
    fun unknownPathIsNotFound() {
        assertEquals(HttpStatusCode.NotFound, get("/nope").first)
    }
}
