// Build-time configuration: which backend we talk to.
export const BASE = import.meta.env.VITE_API_URL as string
if (!BASE) throw new Error('VITE_API_URL is not set. Copy .env.example to .env.local and set it to the ApiUrl output of cdk deploy.')

// Mirrors the backend's ALLOW_PAYMENT_SIMULATION; set VITE_PAYMENT_SIMULATION=false once a real provider exists.
export const paymentSimulation = import.meta.env.VITE_PAYMENT_SIMULATION !== 'false'
