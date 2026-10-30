package main

import (
	"fmt"
	"io"
	"os"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// run is the whole program with injected streams: it returns the exit code.
func run(args []string, stdout, stderr io.Writer) int {
	if len(args) > 1 {
		fmt.Fprintln(stderr, "usage: app [name]")
		return 2
	}
	name := ""
	if len(args) == 1 {
		name = args[0]
	}
	fmt.Fprintln(stdout, Greeting(name))
	return 0
}
