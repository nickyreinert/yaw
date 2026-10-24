package app

func Greeting(name string) string {
	if name == "" {
		name = "world"
	}
	return "Hello, " + name + "!"
}
