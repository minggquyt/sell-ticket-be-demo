const { PayOS } = require('@payos/node');
require('dotenv').config();

// PayOS configuration with validation
const clientId = process.env.PAYOS_CLIENT_ID;
const apiKey = process.env.PAYOS_API_KEY;
const checksumKey = process.env.PAYOS_CHECKSUM_KEY;

if (!clientId || !apiKey || !checksumKey) {
  console.warn('PayOS credentials not configured. Payment features will be disabled.');
  console.warn('Please set PAYOS_CLIENT_ID, PAYOS_API_KEY, and PAYOS_CHECKSUM_KEY in .env file');
  
  // Export mock PayOS object for development without payment
  module.exports = {
    paymentRequests: {
      create: async () => {
        throw new Error('PayOS not configured. Please add credentials to .env file.');
      },
      get: async () => {
        throw new Error('PayOS not configured. Please add credentials to .env file.');
      },
      cancel: async () => {
        throw new Error('PayOS not configured. Please add credentials to .env file.');
      }
    },
    webhooks: {
      verify: async (data) => {
        if (process.env.NODE_ENV === 'production') {
          throw new Error('PayOS webhook verification unavailable: missing credentials.');
        }
        return data;
      }
    }
  };
} else {
  const payos = new PayOS({
    clientId,
    apiKey,
    checksumKey,
  });
  
  module.exports = payos;
}

