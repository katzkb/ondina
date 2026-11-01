package com.example.order.domain

interface OrderRepository {
    fun find(id: OrderId): Order?
    fun save(order: Order)
}
