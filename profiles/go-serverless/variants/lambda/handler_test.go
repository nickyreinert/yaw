package main

import (
	"context"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

func call(t *testing.T, method, path string) events.APIGatewayV2HTTPResponse {
	t.Helper()
	req := events.APIGatewayV2HTTPRequest{RawPath: path}
	req.RequestContext.HTTP.Method = method
	res, err := Handler(context.Background(), req)
	if err != nil {
		t.Fatalf("Handler: %v", err)
	}
	return res
}

func TestRoutes(t *testing.T) {
	for _, tc := range []struct {
		path   string
		status int
		body   string
	}{
		{"/", 200, "Hello, world!"},
		{"/health", 200, "ok"},
		{"/hello/Ada", 200, "Hello, Ada!"},
		{"/hello/Ada%20L", 200, "Hello, Ada L!"},
		{"/hello/%20", 400, "invalid name"},
		{"/hello/%zz", 400, "invalid name"},
		{"/hello/a/b", 404, "not found"},
		{"/missing", 404, "not found"},
	} {
		res := call(t, "GET", tc.path)
		if res.StatusCode != tc.status || res.Body != tc.body {
			t.Errorf("GET %s = %d %q, want %d %q", tc.path, res.StatusCode, res.Body, tc.status, tc.body)
		}
	}
}

func TestMethodNotAllowed(t *testing.T) {
	if res := call(t, "POST", "/health"); res.StatusCode != 405 {
		t.Fatalf("POST /health = %d, want 405", res.StatusCode)
	}
}
