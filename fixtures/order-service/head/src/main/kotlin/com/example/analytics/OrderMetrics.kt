package com.example.analytics

import com.example.order.domain.Money
import com.example.order.domain.Order

class OrderMetrics {
    fun discount(order: Order): Money {
        return order.discount
    }
}
