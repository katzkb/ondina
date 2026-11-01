package com.example.order.domain

@JvmInline
value class Money(val amount: Long) {
    operator fun plus(other: Money) = Money(amount + other.amount)
    operator fun minus(other: Money) = Money(amount - other.amount)
    operator fun times(rate: Rate) = Money(amount * rate.percent / 100)
    operator fun compareTo(other: Money) = amount.compareTo(other.amount)

    companion object {
        val ZERO = Money(0)
    }
}
