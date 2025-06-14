// shared/policies/generatePolicyText.js
// Plain-JavaScript version  (14 Jun 2025)

/**
 * Build a Markdown policy string from a store-specific policy object.
 *
 * Expected object shape:
 * {
 *   handlingTimeDays: number,
 *   cancellationWindowHours: number,
 *   returnsAccepted: boolean,
 *   returnWindowDays: number,
 *   refundProcessingTimeDays: number
 * }
 */
function generatePolicyText(policyParameters) {
    const lines = [];

    /* ----------  SHIPPING  ---------- */
    lines.push('### Shipping');
    lines.push(
        `• Orders are dispatched within **${policyParameters.handlingTimeDays} business day${
            policyParameters.handlingTimeDays === 1 ? '' : 's'
        }** of payment confirmation.`
    );

    /* ----------  CANCELLATIONS  ---------- */
    lines.push('\n### Cancellations');
    lines.push(
        `• You may cancel an order within **${policyParameters.cancellationWindowHours} hour${
            policyParameters.cancellationWindowHours === 1 ? '' : 's'
        }** of placement, provided it has not been shipped.`
    );

    /* ----------  RETURNS & REFUNDS  ---------- */
    lines.push('\n### Returns & Refunds');

    if (!policyParameters.returnsAccepted) {
        lines.push('• **All sales are final. Returns are not accepted.**');
    } else {
        lines.push(
            `• Returns are accepted within **${policyParameters.returnWindowDays} day${
                policyParameters.returnWindowDays === 1 ? '' : 's'
            }** of delivery, provided items are unused, in original packaging, and accompanied by proof of purchase.`
        );
        lines.push(
            `• Approved refunds will be credited back to your original payment method within **${policyParameters.refundProcessingTimeDays} business day${
                policyParameters.refundProcessingTimeDays === 1 ? '' : 's'
            }** after we receive and inspect the returned item(s).`
        );
    }

    return lines.join('\n');
}

module.exports = { generatePolicyText };