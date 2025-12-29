import express, { Request, Response, NextFunction } from 'express';
import morgan from 'morgan';
import { Server } from 'http';
import twilio from 'twilio';
import { transferActiveCall, getCallDetails, activeCalls } from './callManager.js';
import type { TransferRequest, ApiResponse, HealthResponse } from './types.js';
import { router as webhookRoutes } from './webhooks.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); 
app.use(morgan('dev'));

let publicUrl: string | undefined;
let baseUrl: string;

const validateApiKey = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'] as string;
  if (!apiKey || apiKey !== process.env.SERVICE_API_KEY) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  next();
};

// --- ROUTES ---

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', server: baseUrl });
});

app.post('/api/transfer', validateApiKey, async (req: Request, res: Response) => {
  try {
    const { ultravoxCallId, destinationNumber, transferReason } = req.body;
    const result = await transferActiveCall(ultravoxCallId, destinationNumber, transferReason);
    res.json({ status: 'success', data: result });
  } catch (error) {
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

/**
 * AGENT CONFIRMATION ENDPOINT
 * Matches the URL in callManager.ts
 */
app.post('/api/confirm-agent-transfer', (req: Request, res: Response) => {
  const { confName } = req.query;
  const digits = req.body.Digits;

  const twiml = new twilio.twiml.VoiceResponse();

  if (digits === '1') {
    console.log(`Agent accepted. Joining conference: ${confName}`);
    twiml.say('Connecting you now.');
    twiml.dial().conference({
      startConferenceOnEnter: true,
      endConferenceOnExit: true 
    }, confName as string);
  } else {
    console.log(`Agent declined or pressed wrong key.`);
    twiml.say('Transfer cancelled.');
    twiml.hangup();
  }

  res.type('text/xml').send(twiml.toString());
});

app.use('/', webhookRoutes);

async function startApiServer(port: number = 3000, ngrokUrl?: string): Promise<{ server: Server }> {
  publicUrl = ngrokUrl;
  baseUrl = ngrokUrl || `http://localhost:${port}`;
  const server = app.listen(port, () => {
    console.log(`API Server listening on port ${port}. URL: ${baseUrl}`);
  });
  return { server };
}

export { startApiServer };
