package com.example.dashboard

import com.example.order.domain.Money
import com.example.order.domain.Order

class DiscountWidget {
    fun value(order: Order): Money {
        return order.discount
    }
}
