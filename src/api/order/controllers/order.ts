/**
 * order controller
 */

import { factories } from "@strapi/strapi";
import EasyPost from "@easypost/api";
import Stripe from "stripe";

const easyPost = new EasyPost(process.env.EASYPOST_API_KEY);
const stripe = new Stripe(process.env.STRIPE_API_KEY, {
  apiVersion: "2023-08-16",
});

export default factories.createCoreController(
  "api::order.order",
  ({ strapi }) => ({
    async create(ctx) {
      const items = ctx.request.body.data.items;
      const shipping = ctx.request.body.data.shipping;
      const customer = ctx.request.body.data.customer;
      let userID = null;

      if (!items) {
        return ctx.badRequest("items data is missing");
      }

      if (!shipping) {
        return ctx.badRequest("shipping data is missing");
      }

      if (!customer) {
        return ctx.badRequest("customer data is missing");
      }

      if (ctx.state.user) {
        userID = ctx.state.user.id.toString();
      }

      const orderID = new Date().getTime().toString();
      const orderSecret = (
        Math.floor(Math.random() * 90000) + 10000
      ).toString();

      const payment = await stripe.checkout.sessions.create({
        success_url: `${process.env.FRONTEND_URL}/transaction/${orderID}?secret=${orderSecret}`,
        cancel_url: process.env.FRONTEND_URL,
        shipping_options: [
          {
            shipping_rate_data: {
              display_name: shipping.name,
              type: "fixed_amount",
              fixed_amount: {
                amount: parseFloat((shipping.price * 100).toFixed(2)),
                currency: "usd",
              },
            },
          },
        ],
        line_items: items.map((item) => {
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
          };
        }),
        metadata: {
          order_id: orderID,
        },
        payment_intent_data: {
          metadata: {
            order_id: orderID,
          },
        },
        mode: "payment",
      });

      const subTotal = items
        .reduce((total, item) => total + (item?.price ?? 0) * item.qty, 0)
        .toFixed(2);

      const order = await strapi.services["api::order.order"].create({
        data: {
          user_id: userID,
          order_id: orderID,
          payment_status: "UNPAID",
          shipping_status: "WAITING",
          order_secret: orderSecret,
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
            items: items.map((item) => {
              return {
                product: item.id,
                quantity: item.qty,
                price: item.price,
                total: (item.price * item.qty).toFixed(2),
                variant: item.variant_name,
                product_name: item.display_name,
              };
            }),
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
        },
      });

      return {
        url: payment.url,
      };
    },

    async webhookStripe(ctx) {
      const event = ctx.request.body.data;

      // TODO: VALIDATE SIGNATURE
      // const sig = ctx.request.headers['stripe-signature'];
      // const endpointSecret = 'whsec_7f5663feabf73f6a289c547f6f2aa4faedd3da9e87c1df3891440f999aeb4d5a';
      // event = stripe.webhooks.constructEvent(JSON.stringify(ctx.request.body.data, null ,2), sig, endpointSecret);

      let paymentStatus = "UNPAID";
      const listStatus = [
        "EXPIRED",
        "SUCCEEDED",
        "ON PROCESS",
        "CANCELED",
        "FAILED",
      ];

      switch (event.type) {
        case "checkout.session.expired":
          paymentStatus = "EXPIRED";
          break;
        case "charged.succeeded":
          paymentStatus = "SUCCEEDED";
          break;
        case "payment_intent.succeeded":
          paymentStatus = "SUCCEEDED";
          break;
        case "payment_intent.payment_failed":
          paymentStatus = "FAILED";
          break;
        case "payment_intent.processing":
          paymentStatus = "ON PROCESS";
          break;
        case "payment_intent.canceled":
          paymentStatus = "CANCELED";
          break;
        default:
          paymentStatus = event.type;
      }

      if (listStatus.includes(paymentStatus)) {
        let buyLabel = null;

        const orderData = await strapi.db.query("api::order.order").findOne({
          where: {
            order_id: event.data.object.metadata.order_id,
          },
        });

        // Check if the payment status is success and if the previous status is not success. buy a label
        if (
          paymentStatus === "SUCCEEDED" &&
          orderData.payment_status !== "SUCCEEDED" &&
          !orderData.tracking_code
        ) {
          buyLabel = await this.buyLabel(
            orderData.shipping_id,
            orderData.rate_id
          );
        }

        const order = await strapi.db.query("api::order.order").update({
          where: {
            order_id: event.data.object.metadata.order_id,
          },
          data: {
            payment_status: paymentStatus,
            stripe_response_webhook: event,
            shipping_label: buyLabel,
            tracking_code: buyLabel?.tracking_code,
            tracking_url: buyLabel?.tracker?.public_url,
            label_image: buyLabel?.postage_label?.label_url,
          },
        });

        return true;
      }

      return ctx.badRequest("status not handled");
    },

    async buyLabel(id, rate_id) {
      return await easyPost.Shipment.buy(id, rate_id);
    },

    async countPrice(ctx) {
      const items = ctx.request.body.data.items;

      const productId = items.map((item) => item.productId);

      const product = await strapi.services["api::product.product"].find({
        pagination: {
          limit: -1,
        },
        populate: ["thumbnail", "product_variant", "brand", "category"],
        filters: {
          id: {
            $in: productId,
          },
        },
      });

      const products = product.results;

      return items.map((item) => {
        const productData = products.find(
          (product) => item.productId === product.id
        );
        const productVariant = productData?.product_variant.find(
          (variant) => variant.id === item.variantId
        );

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
        };
      });
    },

    async validateAddress(ctx) {
      const data = ctx.request.body.data;

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
        data: address.verifications,
      };
    },

    async shippingRate(ctx) {
      const address = ctx.request.body.data.address;
      const parcel = ctx.request.body.data.parcel;

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
          company: "EasyPost",
          street1: "417 Montgomery Street",
          street2: "5th Floor",
          city: "San Francisco",
          state: "CA",
          zip: "94104",
          phone: "415-528-7555",
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
        rates: shipment.rates,
      };
    },

    async getOrderWithCode(ctx) {
      const code = ctx.params.code;
      const secret = ctx.query.secret;

      const order = await strapi.db.query("api::order.order").findOne({
        where: {
          order_id: code,
          order_secret: secret,
        },
        select: [
          "order_id",
          "tracking_code",
          "stripe_url",
          "tracking_url",
          "createdAt",
          "shipping_name",
          "subtotal",
          "shipping_price",
          "total",
          "payment_status",
        ],
        populate: ["customer_contact", "products.items.product.thumbnail"],
      });

      return order;
    },

    async getMyOrder(ctx) {
      console.log(ctx.state);

      const userID = ctx.state.user.id.toString();
      const status = ctx.query.status;

      if (!userID) {
        ctx.badRequest("User Not Found!");
      }

      let where = null;
      if (status) {
        where = {
          user_id: userID,
          payment_status: status ? status : null,
        };
      } else {
        where = {
          user_id: userID,
        };
      }

      const order = await strapi.db.query("api::order.order").findPage({
        where,
        select: [
          "order_id",
          "tracking_code",
          "stripe_url",
          "tracking_url",
          "createdAt",
          "shipping_name",
          "subtotal",
          "shipping_price",
          "total",
          "payment_status",
        ],
        populate: ["customer_contact", "products.items.product.thumbnail"],
      });

      return order;
    },

    async getOrderById(ctx) {
      const code = ctx.params.code;
      const userID = ctx.state.user.id.toString();

      if (!userID) {
        ctx.badRequest("User Not Found!");
      }

      const order = await strapi.db.query("api::order.order").findOne({
        where: {
          order_id: code,
          user_id: userID,
        },
        select: [
          "order_id",
          "user_id",
          "tracking_code",
          "stripe_url",
          "tracking_url",
          "createdAt",
          "shipping_name",
          "subtotal",
          "shipping_price",
          "total",
          "payment_status",
        ],
        populate: ["customer_contact", "products.items.product.thumbnail"],
      });

      return order;
    },
  })
);
