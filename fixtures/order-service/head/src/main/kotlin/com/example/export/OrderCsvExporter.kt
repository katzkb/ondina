package com.example.export

import com.example.order.domain.Money
import com.example.order.domain.Order

class OrderCsvExporter {
    fun discountColumn(order: Order): Money {
        return order.discount
    }
}
