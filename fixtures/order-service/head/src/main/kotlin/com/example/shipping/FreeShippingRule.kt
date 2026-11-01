package com.example.shipping

import com.example.order.domain.Money
import com.example.order.domain.Order

class FreeShippingRule {
    fun threshold(order: Order): Money {
        return order.subtotal - order.discount
    }
}
