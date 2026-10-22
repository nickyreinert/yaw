package com.example.app

fun greeting(name: String): String = "Hello, ${name.ifBlank { "world" }}!"
