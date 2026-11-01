package com.example.order.domain

object DiscountPolicy {
    private val TABLE: Map<String, Rate> = mapOf(
        "SPRING10" to Rate(10),
        "WELCOME5" to Rate(5),
    )

    fun rateFor(code: String): Rate =
        TABLE[code] ?: Rate.ZERO
}
