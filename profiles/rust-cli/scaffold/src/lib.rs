use std::io::Write;

/// Greeting for a name; an empty name greets the world.
pub fn greeting(name: &str) -> String {
    let name = name.trim();
    let name = if name.is_empty() { "world" } else { name };
    format!("Hello, {name}!")
}

/// Runs the tool; returns the exit code. `args` excludes the program name.
pub fn run<O: Write, E: Write>(args: &[String], out: &mut O, err: &mut E) -> i32 {
    if args.len() > 1 {
        let _ = writeln!(err, "usage: app [name]");
        return 1;
    }
    let name = args.first().map(String::as_str).unwrap_or("");
    match writeln!(out, "{}", greeting(name)) {
        Ok(()) => 0,
        Err(error) => {
            let _ = writeln!(err, "app: {error}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(args: &[&str]) -> (i32, String, String) {
        let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let code = run(&args, &mut out, &mut err);
        (
            code,
            String::from_utf8_lossy(&out).into_owned(),
            String::from_utf8_lossy(&err).into_owned(),
        )
    }

    #[test]
    fn greets_by_name() {
        assert_eq!(call(&["Ada"]), (0, "Hello, Ada!\n".into(), String::new()));
    }

    #[test]
    fn greets_the_world_without_a_name() {
        assert_eq!(call(&[]).1, "Hello, world!\n");
        assert_eq!(greeting("  "), "Hello, world!");
    }

    #[test]
    fn too_many_arguments_print_usage() {
        assert_eq!(
            call(&["a", "b"]),
            (1, String::new(), "usage: app [name]\n".into())
        );
    }
}
