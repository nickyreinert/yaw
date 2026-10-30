package main

// Greeting returns the greeting for name; an empty name greets the world.
func Greeting(name string) string {
	if name == "" {
		name = "world"
	}
	return "Hello, " + name + "!"
}
