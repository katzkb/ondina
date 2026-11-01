package com.example.cart

import com.example.order.domain.Money
import com.example.order.domain.Order

class CartSummary(
    private val order: Order,
    private val items: List<CartItem>,
) {
    fun count(): Int = items.size

    fun total(): Money {
        return items.sumOf { it.price } - order.discount
    }
}
