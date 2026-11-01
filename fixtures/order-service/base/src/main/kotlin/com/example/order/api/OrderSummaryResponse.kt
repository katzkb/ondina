package com.example.order.api

import com.example.order.domain.Order

data class OrderSummaryResponse(
    val id: String,
    val total: Long,
) {
    companion object {
        fun from(o: Order) = OrderSummaryResponse(
            id = o.id.value,
            total = o.total().amount,
        )
    }
}
