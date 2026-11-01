package com.example.support

import com.example.order.domain.Money
import com.example.order.domain.Order

class RefundEstimator {
    fun refundable(order: Order): Money {
        return order.subtotal - order.getDiscount()
    }
}
