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
}
