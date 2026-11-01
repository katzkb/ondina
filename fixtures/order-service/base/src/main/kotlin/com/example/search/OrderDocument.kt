package com.example.search

import com.example.order.domain.Money
import com.example.order.domain.Order

class OrderDocument {
    fun discount(order: Order): Money {
        return order.getDiscount()
    }
}
