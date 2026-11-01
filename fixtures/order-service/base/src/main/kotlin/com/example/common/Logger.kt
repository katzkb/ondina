package com.example.common

object Logger {
    enum class Level { INFO, WARN, ERROR }

    fun format(level: Level, msg: String) = "[$level] $msg"

    fun log(level: Level, msg: String) = println(format(level, msg))
}
