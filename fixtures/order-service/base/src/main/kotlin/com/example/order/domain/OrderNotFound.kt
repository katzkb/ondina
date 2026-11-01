package com.example.order.domain

class OrderNotFound(id: OrderId) : RuntimeException("order not found: ${id.value}")
