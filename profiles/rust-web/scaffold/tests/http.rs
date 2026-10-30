use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

async fn get(uri: &str) -> (StatusCode, String) {
    let request = Request::builder()
        .uri(uri)
        .body(Body::empty())
        .expect("a valid request");
    let response = app::router().oneshot(request).await.expect("a response");
    let status = response.status();
    let body = to_bytes(response.into_body(), 1024).await.expect("a body");
    (status, String::from_utf8_lossy(&body).into_owned())
}

#[tokio::test]
async fn health_is_ok() {
    assert_eq!(get("/health").await, (StatusCode::OK, "ok".into()));
}

#[tokio::test]
async fn greets_by_name() {
    assert_eq!(
        get("/hello/Ada").await,
        (StatusCode::OK, "Hello, Ada!".into())
    );
}

#[tokio::test]
async fn root_greets_the_world() {
    assert_eq!(get("/").await, (StatusCode::OK, "Hello, world!".into()));
}

#[tokio::test]
async fn unknown_route_is_not_found() {
    assert_eq!(get("/nope").await.0, StatusCode::NOT_FOUND);
}
