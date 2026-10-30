use lambda_http::http::Request;
use lambda_http::Body;

async fn get(path: &str) -> (u16, String) {
    let request = Request::builder()
        .uri(path)
        .body(Body::Empty)
        .expect("a valid request");
    let response = app::handler(request).await.expect("a response");
    let status = response.status().as_u16();
    let body = match response.into_body() {
        Body::Text(text) => text,
        other => panic!("unexpected body {other:?}"),
    };
    (status, body)
}

#[tokio::test]
async fn health_is_ok() {
    assert_eq!(get("/health").await, (200, "ok".into()));
}

#[tokio::test]
async fn greets_by_name() {
    assert_eq!(get("/hello/Ada").await, (200, "Hello, Ada!".into()));
}

#[tokio::test]
async fn root_greets_the_world() {
    assert_eq!(get("/").await, (200, "Hello, world!".into()));
}

#[tokio::test]
async fn unknown_route_is_not_found() {
    assert_eq!(get("/nope").await.0, 404);
}
