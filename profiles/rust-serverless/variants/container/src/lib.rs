mod greeting;

pub use greeting::greeting;

use axum::extract::Path;
use axum::routing::get;
use axum::Router;

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
