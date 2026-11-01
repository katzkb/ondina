package com.example.order.domain

class Order(
    val id: OrderId,
    val subtotal: Money,
    val promo: Promo? = null,
) {
    fun getDiscount(): Money = promo?.amount ?: Money.ZERO

    fun total(): Money = subtotal
}
