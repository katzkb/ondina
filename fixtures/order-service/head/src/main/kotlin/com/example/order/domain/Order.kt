package com.example.order.domain

class Order(
    val id: OrderId,
    val subtotal: Money,
    var discount: Money = Money.ZERO,
) {
    fun applyDiscount(cmd: DiscountCommand) {
        val rate = DiscountPolicy.rateFor(cmd.code)
        discount = subtotal * rate
    }

    fun total(): Money = subtotal - discount
}
