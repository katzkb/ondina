package com.example.order.infra

import com.example.order.domain.Money
import com.example.order.domain.Order
import com.example.order.domain.OrderId
import kotlin.test.Test
import kotlin.test.assertEquals

class OrderRepositoryImplTest {
    private val repository = TestDatabase.repository()

    @Test
    fun `round trips subtotal`() {
        repository.save(Order(id = OrderId("o-1"), subtotal = Money(1000)))
        assertEquals(Money(1000), repository.find(OrderId("o-1"))!!.subtotal)
    }

    @Test
    fun `persists discount`() {
        repository.save(orderWithDiscount(100))
        assertEquals(Money(100), repository.find(OrderId("o-1"))!!.discount)
    }

    @Test
    fun `reads zero discount for rows saved before the column existed`() {
        repository.save(Order(id = OrderId("o-2"), subtotal = Money(500)))
        assertEquals(Money.ZERO, repository.find(OrderId("o-2"))!!.discount)
    }

    private fun orderWithDiscount(amount: Long) =
        Order(id = OrderId("o-1"), subtotal = Money(1000), discount = Money(amount))
}
