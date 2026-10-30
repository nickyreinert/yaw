package com.example.app

import com.amazonaws.services.lambda.runtime.Context
import com.amazonaws.services.lambda.runtime.RequestHandler
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2HTTPEvent
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2HTTPResponse

private const val MAX_NAME = 100

/** Lambda handler for an API Gateway HTTP API or function URL request (`com.example.app.Handler::handleRequest`); tests call it directly. */
class Handler : RequestHandler<APIGatewayV2HTTPEvent, APIGatewayV2HTTPResponse> {
    override fun handleRequest(
        event: APIGatewayV2HTTPEvent,
        context: Context?,
    ): APIGatewayV2HTTPResponse {
        val path = event.rawPath.orEmpty().trim('/')
        val (status, body) =
            when {
                path.isEmpty() -> 200 to greeting("")
                path == "health" -> 200 to "ok"
                path.startsWith("hello/") && !path.removePrefix("hello/").contains('/') -> {
                    val name = path.removePrefix("hello/")
                    if (name.length > MAX_NAME) 400 to "name too long" else 200 to greeting(name)
                }
                else -> 404 to "not found"
            }
        return APIGatewayV2HTTPResponse
            .builder()
            .withStatusCode(status)
            .withHeaders(mapOf("content-type" to "text/plain; charset=utf-8"))
            .withBody(body)
            .build()
    }
}
