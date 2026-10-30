use std::process::Command;

fn app(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_app"))
        .args(args)
        .output()
        .expect("the app binary runs")
}

#[test]
fn prints_the_greeting() {
    let output = app(&["Ada"]);
    assert!(output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout), "Hello, Ada!\n");
}

#[test]
fn fails_with_usage_on_too_many_arguments() {
    let output = app(&["a", "b"]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(
        String::from_utf8_lossy(&output.stderr),
        "usage: app [name]\n"
    );
}
