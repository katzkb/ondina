package com.example.order.domain

import kotlin.test.Test
import kotlin.test.assertEquals

class OrderTest {
    @Test
    fun `total is the subtotal without promo`() {
        val order = Order(id = OrderId("o-1"), subtotal = Money(1000))
        assertEquals(Money(1000), order.total())
    }

    @Test
    fun `applies the policy rate to subtotal`() {
        val order = Order(id = OrderId("o-1"), subtotal = Money(1000))
        order.applyDiscount(DiscountCommand("SPRING10"))
        assertEquals(Money(900), order.total())
    }

    @Test
    fun `keeps total when code is unknown`() {
        val order = Order(id = OrderId("o-1"), subtotal = Money(1000))
        order.applyDiscount(DiscountCommand("NOPE"))
        assertEquals(Money(1000), order.total())
    }
}
