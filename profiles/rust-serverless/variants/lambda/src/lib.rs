mod greeting;

pub use greeting::greeting;

use lambda_http::{Body, Error, Request, Response};

/// Lambda handler for an API Gateway / function URL request; tests call it directly.
pub async fn handler(event: Request) -> Result<Response<Body>, Error> {
    let path = event.uri().path().trim_matches('/').to_string();
    let (status, body) = match path.as_str() {
        "" => (200, greeting("")),
        "health" => (200, "ok".to_string()),
        other => match other.strip_prefix("hello/") {
            Some(name) if !name.contains('/') => (200, greeting(name)),
            _ => (404, "not found".to_string()),
        },
    };
    Ok(Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .body(Body::Text(body))?)
}
