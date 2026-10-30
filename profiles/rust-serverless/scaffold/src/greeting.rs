/// Greeting for a name; an empty name greets the world.
pub fn greeting(name: &str) -> String {
    let name = name.trim();
    let name = if name.is_empty() { "world" } else { name };
    format!("Hello, {name}!")
}

#[cfg(test)]
mod tests {
    use super::greeting;

    #[test]
    fn greets_by_name() {
        assert_eq!(greeting("Ada"), "Hello, Ada!");
    }

    #[test]
    fn greets_the_world_without_a_name() {
        assert_eq!(greeting("  "), "Hello, world!");
    }
}
