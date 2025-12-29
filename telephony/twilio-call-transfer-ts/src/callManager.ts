import { createRequire } from 'module';
import twilio from 'twilio';
import type { CallData, TransferResult } from './types.js';

const require = createRequire(import.meta.url);

// Store Ultravox callId and Twilio CallSid mapping when a call starts
// In prod replace the map with a database
const activeCalls = new Map<string, CallData>();

/**
 * Register a new call in the system
 */
function registerCall(ultravoxCallId: string, providerCallSid: string, callerNumber: string, joinUrl?: string): void {
  const callData: CallData = {
    callerNumber,
    startTime: new Date(),
    providerCallSid,
    joinUrl
  };
  
  activeCalls.set(ultravoxCallId, callData);
  console.log(`Call registered: ${ultravoxCallId} -> ${providerCallSid} (Twilio)`);
}

/**
 * Get details about an active call
 */
function getCallDetails(ultravoxCallId: string): CallData | null {
  return activeCalls.get(ultravoxCallId) || null;
}

/**
 * Transfer an active call to a destination number.
 * 
 * Optionally pass in a message that will be whispered to the human agent prior to transferring the call.
 */
async function transferActiveCall(ultravoxCallId: string, destinationNumber: string, transferReason?: string): Promise<TransferResult> {
  const callData = activeCalls.get(ultravoxCallId);
  
  if (!callData || !callData.providerCallSid) {
    throw new Error(`Call not found: ${ultravoxCallId}`);
  }

  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    const baseUrl = process.env.NGROK_URL; // This is your Render URL
    const conferenceName = `conf_${ultravoxCallId}`;

    // 1. Move the ORIGINAL CALLER into the conference room
    // They will hear hold music until the agent joins.
    await client.calls(callData.providerCallSid).update({
      twiml: `
        <Response>
          <Dial>
            <Conference waitUrl="http://twimlets.com/holdmusic/S_Classic">${conferenceName}</Conference>
          </Dial>
        </Response>`
    });

    // 2. Call the HUMAN AGENT
    // We give them the reason and ask them to press 1 to join the conference.
    await client.calls.create({
      to: destinationNumber,
      from: fromNumber!,
      twiml: `
        <Response>
          <Gather numDigits="1" action="${baseUrl}/api/confirm-agent-transfer?confName=${conferenceName}" timeout="15">
            <Say>Hello. You have a transfer request regarding: ${transferReason}. Press 1 to accept and connect to the caller.</Say>
          </Gather>
          <Say>I did not receive an input. Hanging up.</Say>
          <Hangup/>
        </Response>`
    });

    return {
      status: 'success',
      message: 'Warm transfer initiated. Caller is on hold in conference.',
      callDetails: { ultravoxCallId, destinationNumber, transferInitiated: new Date() }
    };

  } catch (error) {
    console.error('Error transferring Twilio call:', error);
    throw error;
  }
}

export {
  registerCall,
  getCallDetails,
  transferActiveCall,
  activeCalls
};
