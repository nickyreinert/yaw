use std::io;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let code = app::run(&args, &mut io::stdout(), &mut io::stderr());
    ExitCode::from(u8::try_from(code).unwrap_or(1))
}
