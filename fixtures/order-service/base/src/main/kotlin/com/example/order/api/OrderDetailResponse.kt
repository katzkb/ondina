package com.example.order.api

import com.example.order.domain.Order

data class OrderDetailResponse(
    val id: String,
    val subtotal: Long,
    val total: Long,
) {
    companion object {
        fun from(o: Order) = OrderDetailResponse(
            id = o.id.value,
            subtotal = o.subtotal.amount,
            total = o.total().amount,
        )
    }
}
