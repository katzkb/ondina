package com.example.order.domain

import kotlin.test.Test
import kotlin.test.assertEquals

class OrderTest {
    @Test
    fun `total is the subtotal without promo`() {
        val order = Order(id = OrderId("o-1"), subtotal = Money(1000))
        assertEquals(Money(1000), order.total())
    }
}
