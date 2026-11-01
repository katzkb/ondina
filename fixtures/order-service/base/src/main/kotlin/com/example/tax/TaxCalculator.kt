package com.example.tax

import com.example.order.domain.Money
import com.example.order.domain.Order

class TaxCalculator {
    fun taxable(order: Order): Money {
        return order.subtotal - order.getDiscount()
    }
}
