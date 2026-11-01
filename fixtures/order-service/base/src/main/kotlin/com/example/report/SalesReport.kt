package com.example.report

import com.example.order.domain.Money
import com.example.order.domain.Order

class SalesReport {
    fun discountOf(order: Order): Money {
        return order.getDiscount()
    }
}
