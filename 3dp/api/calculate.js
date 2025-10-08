// Vercel Serverless Function to calculate 3D print prices.
// This function will live at the endpoint /api/calculate

// The main handler function for the serverless environment
export default function handler(request, response) {
    // We only want to accept POST requests for this endpoint.
    if (request.method !== 'POST') {
        // If it's not a POST, send a 405 'Method Not Allowed' response.
        response.status(405).json({ error: 'Method Not Allowed', message: 'Please use the POST method.' });
        return;
    }

    // Extract the data from the request body.
    const params = request.body;

    // --- Input Validation ---
    // Check for essential parameters to ensure a valid calculation.
    const requiredParams = ['weight', 'hours', 'filamentPrice', 'batch', 'power', 'maintenance', 'handling'];
    const missingParams = requiredParams.filter(p => params[p] === undefined || params[p] === null);

    if (missingParams.length > 0) {
        // If any required parameters are missing, send a 400 'Bad Request' response.
        response.status(400).json({ 
            error: 'Bad Request', 
            message: `Missing required parameters: ${missingParams.join(', ')}` 
        });
        return;
    }

    try {
        // Perform the calculation using the extracted logic.
        const result = performCalculation(params);

        // Send the successful result back as a JSON object with a 200 OK status.
        response.status(200).json(result);

    } catch (error) {
        // If any other error occurs during calculation, send a 500 'Internal Server Error' response.
        console.error("Calculation Error:", error);
        response.status(500).json({ 
            error: 'Internal Server Error', 
            message: 'An unexpected error occurred during the calculation.' 
        });
    }
}

/**
 * Performs the 3D print price calculation.
 * This is the core logic extracted from the original HTML file.
 * @param {object} params - The input parameters for the calculation.
 * @returns {object} - The structured result of the calculation.
 */
function performCalculation(params) {
    // --- Destructure and set defaults for all possible inputs ---
    const {
        weight = 0,
        hours = 0,
        batch = 1,
        filamentPrice = 0,
        electricityPrice = 0,
        power = 0,
        maintenance = 0,
        handling = 0,
        postProcessPiece = 0,
        packageBatch = 0,
        vat = false,
        margins = [30, 50, 100],
        currency = 'USD'
    } = params;
    
    const VAT_RATE = 0.23;
    const safeBatch = Math.max(batch || 1, 1);

    // --- Perform Calculations ---
    const costs = {
        material: filamentPrice * ((weight / 1000) * safeBatch),
        electricity: (power * hours / 1000) * electricityPrice,
        maintenance: maintenance * hours,
        handling: handling,
        extras: packageBatch + (postProcessPiece * safeBatch),
    };

    const totalBatchCost = Object.values(costs).reduce((sum, cost) => sum + cost, 0);
    const costPerPiece = totalBatchCost / safeBatch;
    
    const addVAT = val => vat ? val * (1 + VAT_RATE) : val;
    
    const pricingTiers = margins.map(margin => {
        const pricePerPiece = addVAT(costPerPiece * (1 + margin / 100));
        return {
            margin: margin,
            pricePerPiece: parseFloat(pricePerPiece.toFixed(2)),
            totalForBatch: parseFloat((pricePerPiece * safeBatch).toFixed(2)),
        };
    });

    // --- Structure the Final JSON Response ---
    return {
        currency: currency,
        inputs: {
            weight: weight,
            hours: hours,
            batch: safeBatch,
            filamentPrice: filamentPrice,
            vatApplied: vat
        },
        costs: {
            material: parseFloat(costs.material.toFixed(2)),
            electricity: parseFloat(costs.electricity.toFixed(2)),
            maintenance: parseFloat(costs.maintenance.toFixed(2)),
            handling: parseFloat(costs.handling.toFixed(2)),
            extras: parseFloat(costs.extras.toFixed(2)),
            totalBatchCost: parseFloat(totalBatchCost.toFixed(2)),
            costPerPiece: parseFloat(costPerPiece.toFixed(2))
        },
        pricingTiers: pricingTiers
    };
}
