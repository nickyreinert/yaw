package com.example.app

private const val USAGE = "usage: app [--help] [NAME]"

/** Runs the command; results go to [out], errors to [err]. Returns the exit code. */
fun run(
    args: List<String>,
    out: Appendable,
    err: Appendable,
): Int =
    when {
        args.contains("--help") || args.contains("-h") -> {
            out.appendLine(USAGE)
            0
        }
        args.any { it.startsWith("-") } -> {
            err.appendLine("app: unknown option ${args.first { it.startsWith("-") }}")
            err.appendLine(USAGE)
            2
        }
        args.size > 1 -> {
            err.appendLine("app: expected at most one NAME")
            err.appendLine(USAGE)
            2
        }
        else -> {
            out.appendLine(greeting(args.firstOrNull().orEmpty()))
            0
        }
    }
