use axum::extract::Path;
use axum::routing::get;
use axum::Router;

/// Greeting for a name; an empty name greets the world.
pub fn greeting(name: &str) -> String {
    let name = name.trim();
    let name = if name.is_empty() { "world" } else { name };
    format!("Hello, {name}!")
}

/// Routes of the service; tests drive them without a socket.
pub fn router() -> Router {
    Router::new()
        .route("/", get(|| async { greeting("") }))
        .route("/health", get(|| async { "ok" }))
        .route(
            "/hello/{name}",
            get(|Path(name): Path<String>| async move { greeting(&name) }),
        )
}
