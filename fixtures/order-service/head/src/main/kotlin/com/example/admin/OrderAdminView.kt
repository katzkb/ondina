package com.example.admin

import com.example.order.domain.Money
import com.example.order.domain.Order

class OrderAdminView {
    fun discountField(order: Order): Money {
        return order.discount
    }
}
