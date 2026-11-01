package com.example.order.application

import com.example.order.domain.OrderId
import com.example.order.domain.OrderNotFound
import com.example.order.domain.OrderRepository
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlin.test.Test
import kotlin.test.assertFailsWith

class ApplyDiscountUseCaseTest {
    private val repository = mockk<OrderRepository>(relaxed = true)
    private val useCase = ApplyDiscountUseCase(repository)

    @Test
    fun `throws when order is missing`() {
        every { repository.find(any()) } returns null
        assertFailsWith<OrderNotFound> { useCase.execute(OrderId("nope"), "SPRING10") }
    }

    @Test
    fun `saves the order after applying`() {
        useCase.execute(OrderId("o-1"), "SPRING10")
        verify(exactly = 1) { repository.save(any()) }
    }
}
