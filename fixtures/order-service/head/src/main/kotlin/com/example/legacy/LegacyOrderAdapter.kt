package com.example.legacy

import com.example.order.domain.Money
import com.example.order.domain.Order

class LegacyOrderAdapter {
    fun legacyDiscount(order: Order): Money {
        return order.discount
    }
}
