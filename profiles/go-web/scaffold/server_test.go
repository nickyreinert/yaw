package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func get(t *testing.T, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	NewHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestRoutes(t *testing.T) {
	for _, tc := range []struct {
		path   string
		status int
		body   string
	}{
		{"/", http.StatusOK, "Hello, world!\n"},
		{"/health", http.StatusOK, "ok\n"},
		{"/hello/Ada", http.StatusOK, "Hello, Ada!\n"},
		{"/hello/%20", http.StatusBadRequest, "invalid name\n"},
		{"/hello/a/b", http.StatusNotFound, "404 page not found\n"},
		{"/missing", http.StatusNotFound, "404 page not found\n"},
	} {
		rec := get(t, tc.path)
		if rec.Code != tc.status || rec.Body.String() != tc.body {
			t.Errorf("GET %s = %d %q, want %d %q", tc.path, rec.Code, rec.Body.String(), tc.status, tc.body)
		}
	}
}

func TestMethodNotAllowed(t *testing.T) {
	rec := httptest.NewRecorder()
	NewHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/health", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST /health = %d, want 405", rec.Code)
	}
}
