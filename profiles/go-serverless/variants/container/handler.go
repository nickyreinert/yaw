package main

import (
	"fmt"
	"net/http"
	"strings"
)

// NewHandler returns the routes of the service; tests drive it with httptest.
func NewHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		writeText(w, http.StatusOK, Greeting(""))
	})
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeText(w, http.StatusOK, "ok")
	})
	mux.HandleFunc("GET /hello/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimSpace(r.PathValue("name"))
		if name == "" || len(name) > 100 {
			writeText(w, http.StatusBadRequest, "invalid name")
			return
		}
		writeText(w, http.StatusOK, Greeting(name))
	})
	return mux
}

func writeText(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(status)
	fmt.Fprintln(w, body)
}
