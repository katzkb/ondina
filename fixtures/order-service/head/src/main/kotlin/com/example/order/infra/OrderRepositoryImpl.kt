package com.example.order.infra

import com.example.order.domain.Money
import com.example.order.domain.Order
import com.example.order.domain.OrderId
import com.example.order.domain.OrderRepository
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Repository

@Repository
class OrderRepositoryImpl(
    private val jdbc: NamedParameterJdbcTemplate,
) : OrderRepository {
    override fun save(order: Order) {
        jdbc.update(
            "update orders set subtotal = :subtotal, discount = :discount where id = :id",
            mapOf(
                "id" to order.id.value,
                "subtotal" to order.subtotal.amount,
                "discount" to order.discount.amount,
            ),
        )
    }

    override fun find(id: OrderId): Order? =
        jdbc.query(
            "select id, subtotal, discount from orders where id = :id",
            mapOf("id" to id.value),
        ) { rs, _ ->
            Order(
                id = OrderId(rs.getString("id")),
                subtotal = Money(rs.getLong("subtotal")),
                discount = Money(rs.getLong("discount")),
            )
        }.firstOrNull()
}
