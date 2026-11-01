package com.example.warehouse

import com.example.order.domain.Money
import com.example.order.domain.Order

class PickingSlip {
    fun footerDiscount(order: Order): Money {
        return order.getDiscount()
    }
}
