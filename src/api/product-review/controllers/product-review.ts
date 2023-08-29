/**
 * product-review controller
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::product-review.product-review', ({ strapi }) => ({
  async reviewCount(ctx) {
    const { slug } = ctx.params;
    
    const reviews = await strapi.services['api::product-review.product-review'].find({
      pagination: {
        limit: -1
      },
      filters: {
        show_review: {
          $eq: true
        },
        product: {
          slug: {
            $eq: slug
          }
        }
      }
    })

    let totalReviews = 0;
    let totalRating = 0;

    const reviewsData = reviews.results

    if (reviewsData && reviewsData.length > 0) {
      totalReviews = reviewsData.length;
      totalRating = reviewsData.reduce((sum, review) => sum + review.rating, 0) / totalReviews;
    }

    return {
      totalReviews,
      averageRating: totalRating,
    };
  },
}));
