package main

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/aws/aws-lambda-go/events"
)

// Handler serves an API Gateway HTTP API (payload v2) or function URL request; tests call it directly.
func Handler(_ context.Context, req events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	if req.RequestContext.HTTP.Method != http.MethodGet {
		return text(http.StatusMethodNotAllowed, "method not allowed"), nil
	}
	path := strings.Trim(req.RawPath, "/")
	switch {
	case path == "":
		return text(http.StatusOK, Greeting("")), nil
	case path == "health":
		return text(http.StatusOK, "ok"), nil
	case strings.HasPrefix(path, "hello/") && !strings.Contains(path[len("hello/"):], "/"):
		name, err := url.PathUnescape(path[len("hello/"):])
		name = strings.TrimSpace(name)
		if err != nil || name == "" || len(name) > 100 {
			return text(http.StatusBadRequest, "invalid name"), nil
		}
		return text(http.StatusOK, Greeting(name)), nil
	}
	return text(http.StatusNotFound, "not found"), nil
}

func text(status int, body string) events.APIGatewayV2HTTPResponse {
	return events.APIGatewayV2HTTPResponse{
		StatusCode: status,
		Headers:    map[string]string{"Content-Type": "text/plain; charset=utf-8"},
		Body:       body,
	}
}
