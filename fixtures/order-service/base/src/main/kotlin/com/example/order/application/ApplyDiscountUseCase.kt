package com.example.order.application

import com.example.order.domain.Order
import com.example.order.domain.OrderId
import com.example.order.domain.OrderNotFound
import com.example.order.domain.OrderRepository

/**
 * 注文に割引を適用するユースケース。
 */
class ApplyDiscountUseCase(
    private val repository: OrderRepository,
) {
    fun execute(id: OrderId): Order {
        val order = repository.find(id) ?: throw OrderNotFound(id)
        return order
    }
}
