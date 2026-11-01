package com.example.pricing

import com.example.order.domain.Money
import com.example.order.domain.Order

class PriceBreakdown {
    fun discountPart(order: Order): Money {
        return order.discount
    }
}
