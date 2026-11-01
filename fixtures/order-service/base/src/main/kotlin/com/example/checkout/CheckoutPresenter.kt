package com.example.checkout

import com.example.order.domain.Money
import com.example.order.domain.Order

class CheckoutPresenter {
    fun discountToShow(order: Order): Money {
        return order.getDiscount()
    }
}
