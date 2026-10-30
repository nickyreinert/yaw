package main

import (
	"bytes"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestGreeting(t *testing.T) {
	if got := Greeting("Ada"); got != "Hello, Ada!" {
		t.Fatalf("Greeting() = %q, want %q", got, "Hello, Ada!")
	}
	if got := Greeting(""); got != "Hello, world!" {
		t.Fatalf("Greeting() = %q, want %q", got, "Hello, world!")
	}
}

func TestRun(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := run([]string{"Ada"}, &out, &errOut); code != 0 || out.String() != "Hello, Ada!\n" || errOut.Len() != 0 {
		t.Fatalf("run(Ada) = %d %q %q", code, out.String(), errOut.String())
	}
	out.Reset()
	if code := run(nil, &out, &errOut); code != 0 || out.String() != "Hello, world!\n" {
		t.Fatalf("run() = %d %q", code, out.String())
	}
}

func TestRunUsageError(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := run([]string{"a", "b"}, &out, &errOut); code != 2 || out.Len() != 0 || errOut.String() != "usage: app [name]\n" {
		t.Fatalf("run(a b) = %d %q %q", code, out.String(), errOut.String())
	}
}

// The built binary exits with the code run returns.
func TestBinaryExitCode(t *testing.T) {
	goBin, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go is not on PATH")
	}
	bin := filepath.Join(t.TempDir(), "app")
	if out, err := exec.Command(goBin, "build", "-o", bin, ".").CombinedOutput(); err != nil {
		t.Fatalf("go build: %v\n%s", err, out)
	}
	if out, err := exec.Command(bin, "Ada").Output(); err != nil || string(out) != "Hello, Ada!\n" {
		t.Fatalf("app Ada = %q, %v", out, err)
	}
	if err := exec.Command(bin, "a", "b").Run(); err == nil {
		t.Fatal("app a b should exit non-zero")
	} else if exit, ok := err.(*exec.ExitError); !ok || exit.ExitCode() != 2 {
		t.Fatalf("app a b exit = %v, want 2", err)
	}
}
