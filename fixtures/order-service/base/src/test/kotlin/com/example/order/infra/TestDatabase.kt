package com.example.order.infra

import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource

object TestDatabase {
    fun repository(): OrderRepositoryImpl =
        OrderRepositoryImpl(NamedParameterJdbcTemplate(DriverManagerDataSource("jdbc:h2:mem:orders")))
}
