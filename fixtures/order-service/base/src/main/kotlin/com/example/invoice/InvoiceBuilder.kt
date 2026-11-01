package com.example.invoice

import com.example.order.domain.Money
import com.example.order.domain.Order

class InvoiceBuilder {
    fun discountLine(order: Order): Money {
        return order.getDiscount()
    }

    fun grandTotal(order: Order): Money {
        return order.subtotal - order.getDiscount()
    }
}
