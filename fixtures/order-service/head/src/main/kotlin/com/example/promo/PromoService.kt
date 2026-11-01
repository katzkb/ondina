package com.example.promo

import com.example.order.domain.Money
import com.example.order.domain.Order

class PromoService(
    private val legacy: LegacyPromoGateway,
) {
    fun apply(order: Order): Money {
        val d = order.discount.takeIf { it > Money.ZERO } ?: legacyPromo(order)
        return d
    }

    private fun legacyPromo(order: Order): Money = legacy.amountFor(order.id)
}
