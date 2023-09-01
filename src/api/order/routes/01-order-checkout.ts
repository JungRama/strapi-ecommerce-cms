module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/orders/checkout/count-price',
      handler: 'order.countPrice',
    },
    {
      method: 'POST',
      path: '/orders/checkout/validate-address',
      handler: 'order.validateAddress',
    },
    {
      method: 'POST',
      path: '/orders/checkout/shipping-rate',
      handler: 'order.shippingRate',
    },
    {
      method: 'POST',
      path: '/orders/checkout/webhook-stripe',
      handler: 'order.webhookStripe',
    }
  ]
}