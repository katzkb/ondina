package com.example.promo

import com.example.order.domain.Money
import com.example.order.domain.OrderId

interface LegacyPromoGateway {
    fun amountFor(id: OrderId): Money
}
