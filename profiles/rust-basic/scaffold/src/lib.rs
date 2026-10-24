pub fn greeting(name: &str) -> String {
    let name = if name.trim().is_empty() {
        "world"
    } else {
        name
    };
    format!("Hello, {name}!")
}
