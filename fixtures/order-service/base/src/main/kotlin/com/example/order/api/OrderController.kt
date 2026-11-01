package com.example.order.api

import com.example.order.application.ApplyDiscountUseCase
import com.example.order.domain.OrderId
import com.example.order.domain.OrderRepository
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RestController

@RestController
class OrderController(
    private val useCase: ApplyDiscountUseCase,
    private val repository: OrderRepository,
) {
    @PostMapping("/orders/{id}/discount")
    fun apply(@PathVariable id: String): OrderResponse {
        val order = useCase.execute(OrderId(id))
        return OrderResponse.from(order)
    }
}
