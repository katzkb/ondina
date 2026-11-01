package com.example.loyalty

import com.example.order.domain.Money
import com.example.order.domain.Order

class PointCalculator {
    fun base(order: Order): Money {
        return order.subtotal - order.getDiscount()
    }
}
