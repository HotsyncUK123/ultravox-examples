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
app.use(express.urlencoded({ extended: true })); // Added to handle Twilio's POST data
app.use(morgan('dev'));

let publicUrl: string | undefined;
let baseUrl: string;

// Enhanced logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} - ${req.method} ${req.url}`);
  
  if (req.url.includes('webhook') || req.url.includes('status') || req.url.includes('stream-events') || req.url.includes('connect-conference')) {
    console.log(`🔔 Twilio Webhook/Action detected: ${req.method} ${req.url}`);
  }
  
  next();
});

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
  const healthResponse: HealthResponse = { 
    status: 'ok', 
    timestamp: new Date(),
    server: {
      local: `http://localhost:${process.env.API_PORT || 3000}`,
      public: publicUrl || 'Not available yet'
    },
    webhookEndpoints: {
      status: `${baseUrl}/status`,
      streamEvents: `${baseUrl}/stream-events`,
      recording: `${baseUrl}/recording`
    }
  };
  
  res.json(healthResponse);
});

// Get call details
app.get('/api/calls/:callId', validateApiKey, (req: Request, res: Response) => {
  const { callId } = req.params;
  const callDetails = getCallDetails(callId);
  
  if (!callDetails) {
    res.status(404).json({ status: 'error', message: `Call not found: ${callId}` } as ApiResponse);
    return;
  }
  
  const sanitizedDetails = {
    ultravoxCallId: callId,
    provider: 'twilio',
    providerCallSid: callDetails.providerCallSid.substring(0, 5) + '...',
    callerNumber: callDetails.callerNumber,
    startTime: callDetails.startTime
  };
  
  res.json({ status: 'success', data: sanitizedDetails } as ApiResponse<typeof sanitizedDetails>);
});

// Debug Active Calls
app.get('/api/debug/calls', validateApiKey, (req: Request, res: Response) => {
  try {
    const callsArray = Array.from(activeCalls.entries()).map(([ultravoxCallId, callData]) => ({
      ultravoxCallId,
      ...callData
    }));
    
    res.json({
      status: 'success',
      timestamp: new Date(),
      activeCalls: callsArray,
      count: callsArray.length
    } as ApiResponse);
  } catch (error) {
    res.status(500).json({ status: 'error', message: (error as Error).message } as ApiResponse);
  }
});

// Transfer call endpoint (Triggered by AI Tool)
app.post('/api/transfer', validateApiKey, async (req: Request, res: Response) => {
  try {
    const { ultravoxCallId, destinationNumber, transferReason, useWhisper }: TransferRequest = req.body;

    if (!ultravoxCallId || !destinationNumber) {
      res.status(400).json({ status: 'error', message: 'Missing required fields' } as ApiResponse);
      return;
    }
    
    const result = await transferActiveCall(ultravoxCallId, destinationNumber, transferReason);
    
    res.json({ status: 'success', data: result } as ApiResponse);
  } catch (error) {
    console.error('Transfer API error:', error);
    res.status(500).json({ status: 'error', message: (error as Error).message } as ApiResponse);
  }
});

/**
 * WARM TRANSFER HANDSHAKE
 * This endpoint is called when the human agent presses a key.
 * It moves both the original caller and the agent into the conference room.
 */
app.post('/connect-conference/:conferenceName/:originalCallSid', async (req: Request, res: Response) => {
  const { conferenceName, originalCallSid } = req.params;
  const digits = req.body.Digits; // The key the agent pressed

  console.log(`Agent pressed: ${digits}. Connecting parties to conference: ${conferenceName}`);
  
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    // 1. Move the original caller (who is currently hearing hold music) into the conference
    await client.calls(originalCallSid).update({
      twiml: `<Response><Dial><Conference>${conferenceName}</Conference></Dial></Response>`
    });

    // 2. Tell the Agent they are being connected and put them in the same conference
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({ voice: 'alice' }, 'Connecting you now.');
    twiml.dial().conference({
      startConferenceOnEnter: true,
      endConferenceOnExit: true 
    }, conferenceName);

    res.type('text/xml').send(twiml.toString());
  } catch (error) {
    console.error('Error connecting parties to conference:', error);
    res.status(500).send('Error connecting call');
  }
});

// Mount webhook routes
app.use('/', webhookRoutes);

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('API Server Error:', err);
  res.status(500).json({ status: 'error', message: 'Internal Server Error' } as ApiResponse);
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
