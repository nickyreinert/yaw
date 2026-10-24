use app::greeting;

#[test]
fn greets_by_name() {
    assert_eq!(greeting("Ada"), "Hello, Ada!");
}
