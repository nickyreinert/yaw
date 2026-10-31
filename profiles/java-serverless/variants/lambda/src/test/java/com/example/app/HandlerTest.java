package com.example.app;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.amazonaws.services.lambda.runtime.events.APIGatewayV2HTTPEvent;
import org.junit.jupiter.api.Test;

class HandlerTest {
  private static APIGatewayV2HTTPEvent event(String method, String path) {
    var http = APIGatewayV2HTTPEvent.RequestContext.Http.builder().withMethod(method).build();
    var context = APIGatewayV2HTTPEvent.RequestContext.builder().withHttp(http).build();
    return APIGatewayV2HTTPEvent.builder().withRawPath(path).withRequestContext(context).build();
  }

  private static String call(String method, String path) {
    var response = new Handler().handleRequest(event(method, path), null);
    return response.getStatusCode() + " " + response.getBody();
  }

  @Test
  void healthIsOk() {
    assertEquals("200 ok", call("GET", "/health"));
  }

  @Test
  void helloGreetsByName() {
    assertEquals("200 Hello, Ada!", call("GET", "/hello/Ada"));
  }

  @Test
  void unknownPathIsNotFound() {
    assertEquals("404 not found", call("GET", "/nope"));
  }

  @Test
  void otherMethodsAreRejected() {
    assertEquals("405 method not allowed", call("POST", "/health"));
  }
}
