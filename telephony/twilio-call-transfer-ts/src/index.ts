import dotenv from 'dotenv';
import { startApiServer } from './apiServer.js';

// Load environment variables from .env file
dotenv.config();

/**
 * Main entry point for the Ultravox Transfer Service.
 * 
 * Since you are using an inbound PHP script, this service 
 * simply runs the API server to handle the transfer logic.
 */
async function main(): Promise<void> {
    // Render typically provides a PORT environment variable
    const API_PORT = parseInt(process.env.PORT || process.env.API_PORT || '3000');
    
    // In Render, NGROK_URL should be set to your https://xxx.onrender.com URL
    const NGROK_URL = process.env.NGROK_URL;

    console.log('--- Starting Ultravox Transfer API Server ---');

    try {
        // Start the API server defined in apiServer.ts
        // This will listen for /api/transfer and /api/confirm-agent-transfer
        await startApiServer(API_PORT, NGROK_URL);

        console.log('Service is live and waiting for transfer requests.');
        console.log(`Public URL: ${NGROK_URL}`);
        console.log(`Target Human Agent: ${process.env.DESTINATION_PHONE_NUMBER}`);
        
    } catch (error) {
        console.error('Error starting the API server:', (error as Error).message);
        process.exit(1);
    }
}

// Run the application
main().catch((err) => {
    console.error('Unhandled error in main:', err);
    process.exit(1);
});
