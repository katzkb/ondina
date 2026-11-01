package com.example.notification

import com.example.order.domain.Money
import com.example.order.domain.Order

class OrderMailer {
    fun discountLine(order: Order): Money {
        val d = order.discount
        return d
    }
}
