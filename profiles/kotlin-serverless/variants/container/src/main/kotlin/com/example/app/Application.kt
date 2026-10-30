package com.example.app

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing

/** Routes of the service; tests drive them without a socket. */
fun Application.module() {
    routing {
        get("/") { call.respondText(greeting("")) }
        get("/health") { call.respondText("ok") }
        get("/hello/{name}") {
            val name = call.parameters["name"].orEmpty()
            if (name.length > 100) {
                call.respondText("name too long", status = HttpStatusCode.BadRequest)
            } else {
                call.respondText(greeting(name))
            }
        }
    }
}

/** Reads HOST (default 127.0.0.1) and PORT (default 8080); the platform sets PORT. Shuts down gracefully on SIGTERM. */
fun main() {
    val host = System.getenv("HOST") ?: "127.0.0.1"
    val port = System.getenv("PORT")?.toIntOrNull() ?: 8080
    embeddedServer(Netty, port = port, host = host, module = Application::module).start(wait = true)
}
