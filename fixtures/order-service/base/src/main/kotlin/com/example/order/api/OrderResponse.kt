package com.example.order.api

import com.example.order.domain.Order

data class OrderResponse(
    val id: String,
    val subtotal: Long,
) {
    companion object {
        fun from(o: Order) = OrderResponse(
            id = o.id.value,
            subtotal = o.subtotal.amount,
        )
    }
}
