package com.example.audit

import com.example.order.domain.Money
import com.example.order.domain.Order

class OrderAuditLog {
    fun discountAtAudit(order: Order): Money {
        return order.getDiscount()
    }
}
