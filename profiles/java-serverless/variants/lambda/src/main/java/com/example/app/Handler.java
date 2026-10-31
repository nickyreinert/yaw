package com.example.app;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2HTTPEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2HTTPResponse;
import java.util.Map;

/**
 * Lambda handler for an API Gateway HTTP API or function URL request ({@code
 * com.example.app.Handler::handleRequest}); tests call it directly.
 */
public class Handler implements RequestHandler<APIGatewayV2HTTPEvent, APIGatewayV2HTTPResponse> {
  @Override
  public APIGatewayV2HTTPResponse handleRequest(APIGatewayV2HTTPEvent event, Context context) {
    var method =
        event.getRequestContext() == null || event.getRequestContext().getHttp() == null
            ? "GET"
            : event.getRequestContext().getHttp().getMethod();
    var response = Routes.handle(method, event.getRawPath());
    return APIGatewayV2HTTPResponse.builder()
        .withStatusCode(response.status())
        .withHeaders(Map.of("content-type", "text/plain; charset=utf-8"))
        .withBody(response.body())
        .build();
  }
}
