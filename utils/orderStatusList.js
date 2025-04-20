const orderStatusList = [
    "Order Created", // Order has been placed by the customer
    "Payment Initiated", // Payment is not yet confirmed
    "Payment Failed", // Payment has been successfully processed
    "Payment Received", // Payment has been successfully processed
    "Processing", // Order is being prepared
    "Ready for Pickup", // For pickup orders, when ready at the store
    "Awaiting Shipment", // Order is packed but not shipped
    "Shipped", // Order has been dispatched
    "Out for Delivery", // Order is out for delivery
    "Delivered", // Order has been delivered
    "On Hold", // Order is temporarily on hold
    "Canceled", // Order has been canceled
    "Refund Requested", // Customer has requested a refund
    "Refund Processed", // Refund has been issued
    "Failed", // Order failed (e.g., payment or processing issue)
    "Returned", // Product has been returned by the customer
];

const getCompletedOrderStatuses = () => {
    const shippedIndex = orderStatusList.indexOf("Shipped");
    return orderStatusList.slice(shippedIndex); // All statuses from 'Shipped' onwards
};

const getPaidOrderStatuses = () => {
    const paidIndex = orderStatusList.indexOf("Payment Received");
    return orderStatusList.slice(paidIndex); // All statuses from 'Payment Received' onward
};

const getSalesEligibleOrderStatuses = () => {
    const startIndex = orderStatusList.indexOf("Payment Received");
    const exclude = new Set([
        "Refund Requested",
        "Refund Processed",
        "Returned",
    ]);
    return orderStatusList
        .slice(startIndex)
        .filter((status) => !exclude.has(status));
};

module.exports = {orderStatusList, getCompletedOrderStatuses, getPaidOrderStatuses, getSalesEligibleOrderStatuses};