package app

import "testing"

func TestGreeting(t *testing.T) {
	if got := Greeting("Ada"); got != "Hello, Ada!" {
		t.Fatalf("Greeting() = %q, want %q", got, "Hello, Ada!")
	}
}
