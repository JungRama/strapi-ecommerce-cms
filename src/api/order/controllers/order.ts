/**
 * order controller
 */

import { factories } from '@strapi/strapi'
import EasyPost from '@easypost/api'
import Stripe from 'stripe';

const easyPost = new EasyPost('')
const stripe = new Stripe('', {
  apiVersion: '2023-08-16'
})

export default factories.createCoreController('api::order.order', ({ strapi }) => ({

  async create(ctx) {
    const items = ctx.request.body.data.items
    const shipping = ctx.request.body.data.shipping
    const customer = ctx.request.body.data.customer

    if(!items) {
      return ctx.badRequest('items data is missing')
    }

    if(!shipping) {
      return ctx.badRequest('shipping data is missing')
    }
    
    if(!customer) {
      return ctx.badRequest('customer data is missing')
    }

    const orderID = new Date().getTime().toString()

    const payment = await stripe.checkout.sessions.create({
      success_url: 'http://localhost:3000/payment/success?clear-cart=true',
      cancel_url: 'http://localhost:3000',
      shipping_options: [
        {
          shipping_rate_data: {
            display_name: shipping.name,
            type: 'fixed_amount',
            fixed_amount: {
              amount: parseFloat((shipping.price * 100).toFixed(2)),
              currency: 'usd'
            }
          }
        }
      ],
      line_items: items.map(item => {
        return {
          price_data: { 
            currency: "usd", 
            product_data: { 
              images: [item.image],
              name: item.display_name, 
            }, 
            unit_amount: parseFloat((item.price * 100).toFixed(2)), 
          }, 
          quantity: item.qty,
        }
      }),
      metadata: {
        order_id: orderID
      },
      payment_intent_data: {
        "metadata": {
          order_id: orderID
        }
      },
      mode: 'payment'
    })

    const subTotal = items.reduce((total, item) => total + (item?.price ?? 0) * item.qty, 0).toFixed(2)

    const order = await strapi.services['api::order.order'].create({
      data: {
        order_id: orderID,
        payment_status: 'UNPAID',
        shipping_status: 'WAITING',
        customer_contact: {
          name: customer.name,
          email: customer.email,
          phone_number: customer.phone_number,
          address: customer.street_address,
          country: customer.country,
          state: customer.state,
          city: customer.city,
          zip_code: customer.zip_code,
        },
        products: {
          items: items.map(item => {
            return {
              product: item.id,
              quantity: item.qty,
              price: item.price,
              total: (item.price * item.qty).toFixed(2),
              variant: item.variant_name,
              product_name: item.display_name,
            }
          })
        },
        shipping_id: shipping.id,
        rate_id: shipping.id_rate,
        shipping_name: shipping.name,
        stripe_id: payment.id,
        stripe_url: payment.url,
        stripe_request: payment,
        subtotal: subTotal,
        shipping_price: shipping.price,
        total: parseFloat(shipping.price) + parseFloat(subTotal),
      }
    })

    return {
      url: payment.url
    }
  },

  async webhookStripe(ctx) {

    const event = ctx.request.body.data

    // TODO: VALIDATE SIGNATURE
    // const sig = ctx.request.headers['stripe-signature'];
    // const endpointSecret = 'whsec_7f5663feabf73f6a289c547f6f2aa4faedd3da9e87c1df3891440f999aeb4d5a';
    // event = stripe.webhooks.constructEvent(JSON.stringify(ctx.request.body.data, null ,2), sig, endpointSecret);

    let paymentStatus = 'UNPAID'

    switch (event.type) {
      case 'payment_intent.succeeded':
        paymentStatus = 'SUCCEEDED'
        break;
      case 'payment_intent.payment_failed':
        paymentStatus = 'FAILED'
        break;
      case 'payment_intent.canceled':
        paymentStatus = 'CANCELED'
        break;
      // case 'charge.succeeded':
      //   paymentStatus = 'SUCCEEDED'
      //   break;
      // case 'charge.failed':
      //   paymentStatus = 'FAILED'
      //   break;
      // case 'charge.refunded':
      //   paymentStatus = 'REFUND'
      //   break;
      // case 'charge.refunded':
      //   paymentStatus = 'REFUND'
      //   break;
      default:
        paymentStatus = 'UNPAID'
    }

    const order = await strapi.db.query('api::order.order').update({
      where: { 
        order_id: event.data.object.metadata.order_id
       },
      data: {
        payment_status: paymentStatus,
        stripe_response_webhook: event
      },
    });

    if(paymentStatus === 'PAID') {
      await this.buyLabel(order.shipping_id, order.rate_id)
    }

    return paymentStatus
  },

  async buyLabel(id, rate_id) {
    
    return await easyPost.Shipment.buy(id, rate_id)
  },

  async countPrice(ctx) {
    const items = ctx.request.body.data.items

    const productId = items.map(item => item.productId)

    const product = await strapi.services['api::product.product'].find({
      pagination: {
        limit: -1
      },
      populate: [
        'thumbnail',
        'product_variant',
        'brand',
        'category',
      ],
      filters: {
        id: {
          $in: productId
        }
      }
    })

    const products = product.results

    return items.map((item) => {
      const productData = products.find(product => item.productId === product.id)
      const productVariant = productData?.product_variant.find(variant => variant.id === item.variantId)

      return {
        id: productData?.id,
        image: productData?.thumbnail.url,
        name: productData?.name,
        variant_id: productVariant?.id,
        variant_name: productVariant?.variant_name,
        price: productVariant?.variant_price,
        width: productVariant?.width,
        length: productVariant?.length,
        height: productVariant?.height,
        weight: productVariant?.weight,
      }
    })
  },
  async validateAddress(ctx) {
    const data = ctx.request.body.data

    const address = await easyPost.Address.create({
      verify: true,
      street1: data.street_address,
      city: data.city,
      state: data.state,
      zip: data.zip_code,
      country: data.country,
      phone: data.phone_number,
    });

    return {
      isVerified: address.verifications?.delivery?.success ?? false,
      data: address.verifications
    }
  },

  async shippingRate(ctx) {
    const address = ctx.request.body.data.address
    const parcel = ctx.request.body.data.parcel

    const shipment = await easyPost.Shipment.create({
      to_address: {
        name: address.name,
        street1: address.street_address,
        city: address.city,
        state: address.state,
        zip: address.zip_code,
        country: address.country,
        phone: address.phone_number,
      },
      from_address: {
        company: 'EasyPost',
        street1: '417 Montgomery Street',
        street2: '5th Floor',
        city: 'San Francisco',
        state: 'CA',
        zip: '94104',
        phone: '415-528-7555',
      },
      parcel: {
        length: parcel.length,
        width: parcel.width,
        height: parcel.width,
        weight: parcel.weight,
      },
    });
    
    return {
      id: shipment.id,
      rates: shipment.rates
    }
  },
}));

