package com.example.receipt

import com.example.order.domain.Money
import com.example.order.domain.Order

class ReceiptPrinter {
    fun discountLine(order: Order): Money {
        val d = order.discount
        return d
    }
}
