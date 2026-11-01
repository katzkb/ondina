package com.example.order.domain

data class Rate(val percent: Long) {
    companion object {
        val ZERO = Rate(0)
    }
}
