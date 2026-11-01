package com.example.common

import java.time.Instant

object Logger {
    enum class Level { INFO, WARN, ERROR }

    fun format(level: Level, msg: String) = "[$level] ${Instant.now()} $msg"

    fun log(level: Level, msg: String) = println(format(level, msg))
}
