import { createRequire } from 'module';
import twilio from 'twilio';
import type { CallData, TransferResult } from './types.js';

const require = createRequire(import.meta.url);
const activeCalls = new Map<string, CallData>();

function registerCall(ultravoxCallId: string, providerCallSid: string, callerNumber: string, joinUrl?: string): void {
  const callData: CallData = { callerNumber, startTime: new Date(), providerCallSid, joinUrl };
  activeCalls.set(ultravoxCallId, callData);
  console.log(`Call registered: ${ultravoxCallId} -> ${providerCallSid}`);
}

function getCallDetails(ultravoxCallId: string): CallData | null {
  return activeCalls.get(ultravoxCallId) || null;
}

async function transferActiveCall(ultravoxCallId: string, destinationNumber: string, transferReason?: string): Promise<TransferResult> {
  const callData = activeCalls.get(ultravoxCallId);
  
  if (!callData || !callData.providerCallSid) {
    throw new Error(`Call not found: ${ultravoxCallId}`);
  }

  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    const baseUrl = process.env.NGROK_URL; 
    const conferenceName = `conf_${ultravoxCallId}`;

    // 1. Move the ORIGINAL CALLER into the conference room immediately
    // They will hear hold music until the agent joins.
    await client.calls(callData.providerCallSid).update({
      twiml: `<Response><Dial><Conference waitUrl="http://twimlets.com/holdmusic/S_Classic">${conferenceName}</Conference></Dial></Response>`
    });

    // 2. Call the HUMAN AGENT
    // We point them to the /api/confirm-agent-transfer endpoint
    await client.calls.create({
      to: destinationNumber,
      from: fromNumber!,
      twiml: `
        <Response>
          <Gather numDigits="1" action="${baseUrl}/api/confirm-agent-transfer?confName=${conferenceName}" timeout="15">
            <Say>Hello. You have a transfer request regarding: ${transferReason}. Press 1 to accept and connect.</Say>
          </Gather>
          <Say>No input received. Hanging up.</Say>
          <Hangup/>
        </Response>`
    });

    return {
      status: 'success',
      message: 'Warm transfer initiated. Caller is on hold.',
      callDetails: { ultravoxCallId, destinationNumber, transferInitiated: new Date() }
    };

  } catch (error) {
    console.error('Error transferring Twilio call:', error);
    throw error;
  }
}

export { registerCall, getCallDetails, transferActiveCall, activeCalls };
