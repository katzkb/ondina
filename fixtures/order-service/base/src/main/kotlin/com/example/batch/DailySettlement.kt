package com.example.batch

import com.example.order.domain.Money
import com.example.order.domain.Order

class DailySettlement {
    fun settledDiscount(order: Order): Money {
        return order.getDiscount()
    }
}
