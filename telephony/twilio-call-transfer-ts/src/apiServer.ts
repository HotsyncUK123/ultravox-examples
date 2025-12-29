import express, { Request, Response, NextFunction } from 'express';
import morgan from 'morgan';
import { Server } from 'http';
import twilio from 'twilio';
import { transferActiveCall, getCallDetails, activeCalls } from './callManager.js';
import type { TransferRequest, ApiResponse, HealthResponse } from './types.js';
import { router as webhookRoutes } from './webhooks.js';

// Initialize Express app
const app = express();

// Middleware
app.use(express.json());
// Crucial: Twilio sends data as URL-encoded form data for Gather actions
app.use(express.urlencoded({ extended: true })); 
app.use(morgan('dev'));

let publicUrl: string | undefined;
let baseUrl: string;

// Simple API key validation middleware
const validateApiKey = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'] as string;
  
  if (!apiKey || apiKey !== process.env.SERVICE_API_KEY) {
    res.status(401).json({ 
      status: 'error', 
      message: 'Unauthorized: Invalid or missing API key' 
    } as ApiResponse);
    return;
  }
  
  next();
};

// --- ROUTES ---

// Health Check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    server: baseUrl
  });
});

// Debug Active Calls
app.get('/api/debug/calls', validateApiKey, (req: Request, res: Response) => {
  const callsArray = Array.from(activeCalls.entries()).map(([ultravoxCallId, callData]) => ({
    ultravoxCallId,
    ...callData
  }));
  res.json({ status: 'success', activeCalls: callsArray });
});

/**
 * TRANSFER ENDPOINT
 * This is what Ultravox hits when the AI triggers the tool.
 */
app.post('/api/transfer', validateApiKey, async (req: Request, res: Response) => {
  try {
    const { ultravoxCallId, destinationNumber, transferReason, providerCallSid } = req.body;

    console.log(`Transfer request received for Ultravox ID: ${ultravoxCallId}`);

    if (!ultravoxCallId || !destinationNumber) {
      res.status(400).json({ status: 'error', message: 'Missing required fields' });
      return;
    }
    
    // We pass providerCallSid (from PHP) as the 4th argument
    const result = await transferActiveCall(ultravoxCallId, destinationNumber, transferReason, providerCallSid);
    
    res.json({ status: 'success', data: result });
    
  } catch (error) {
    console.error('Transfer API error:', error);
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

/**
 * AGENT CONFIRMATION ENDPOINT
 * This is what Twilio hits when the human agent presses a key.
 */
app.post('/api/confirm-agent-transfer', (req: Request, res: Response) => {
  const { confName } = req.query;
  const digits = req.body.Digits;

  const twiml = new twilio.twiml.VoiceResponse();

  if (digits === '1') {
    console.log(`Agent accepted transfer. Joining conference: ${confName}`);
    twiml.say({ voice: 'alice' }, 'Connecting you now.');
    twiml.dial().conference({
      startConferenceOnEnter: true,
      endConferenceOnExit: true 
    }, confName as string);
  } else {
    console.log(`Agent declined transfer or pressed wrong key: ${digits}`);
    twiml.say({ voice: 'alice' }, 'Transfer cancelled. Goodbye.');
    twiml.hangup();
  }

  res.type('text/xml').send(twiml.toString());
});

// Mount webhook routes (for status and stream events)
app.use('/', webhookRoutes);

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('API Server Error:', err);
  res.status(500).json({ status: 'error', message: 'Internal Server Error' });
});

/**
 * Start the API server
 */
async function startApiServer(port: number = 3000, ngrokUrl?: string): Promise<{ server: Server }> {
  publicUrl = ngrokUrl;
  baseUrl = ngrokUrl || `http://localhost:${port}`;

  const server = app.listen(port, () => {
    console.log(`API Server listening on port ${port}`);
    console.log(`Public URL: ${baseUrl}`);
  });
  
  return { server };
}

export { startApiServer };
