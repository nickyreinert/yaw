package com.example.app

import kotlin.system.exitProcess

fun main(args: Array<String>) {
    exitProcess(run(args.toList(), System.out, System.err))
}
