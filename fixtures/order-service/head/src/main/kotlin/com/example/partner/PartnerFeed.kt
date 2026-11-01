package com.example.partner

import com.example.order.domain.Money
import com.example.order.domain.Order

class PartnerFeed {
    fun discountPayload(order: Order): Money {
        return order.discount
    }
}
