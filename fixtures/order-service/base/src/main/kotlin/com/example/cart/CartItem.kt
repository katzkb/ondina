package com.example.cart

import com.example.order.domain.Money

data class CartItem(val sku: String, val price: Money)
