
const knex = require('@database/knexInstance');

async function isOfferApplicable(productId, offer, offerCodes) {

    if (offer.requireCode && (!offerCodes || !offerCodes.includes(offer.offerCode))) {
        return false;
    }

    // Fetch product details (including collections and tags) if not provided
    const product = await knex("products")
        .where("productId", productId)
        .select("productId", "productTags")
        .first();

    if (!product) return false; // Product does not exist

    if (offer.applicableTo.storeWide) {
        return true;
    }
    // Fetch collections for the product
    const collections = await knex("productCollections")
        .where("productId", productId)
        .pluck("collectionId");

    const { productTags } = product;
    const applicableTo = offer.applicableTo;


    return (
        (applicableTo.productIds && applicableTo.productIds.includes(productId)) ||
        (applicableTo.collectionIds && applicableTo.collectionIds.some(id => collections.includes(id))) ||
        (applicableTo.productTags && applicableTo.productTags.some(tag => productTags.includes(tag)))
    );
}