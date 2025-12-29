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
 * @param ultravoxCallId - The ID from Ultravox
 * @param destinationNumber - The human agent's number
 * @param transferReason - The reason provided by the AI
 * @param manualCallSid - The Twilio SID passed from the PHP script
 */
async function transferActiveCall(
  ultravoxCallId: string, 
  destinationNumber: string, 
  transferReason?: string,
  manualCallSid?: string
): Promise<TransferResult> {
  
  // Determine which Twilio SID to use (Memory or Manual)
  const callData = activeCalls.get(ultravoxCallId);
  const twilioCallSid = manualCallSid || callData?.providerCallSid;
  
  if (!twilioCallSid) {
    throw new Error(`Call SID not found for Ultravox ID: ${ultravoxCallId}. Ensure providerCallSid is passed.`);
  }

  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    const baseUrl = process.env.NGROK_URL; // This is your Render URL
    const conferenceName = `conf_${ultravoxCallId}`;

    console.log(`Initiating warm transfer for SID: ${twilioCallSid} to ${destinationNumber}`);

    // 1. Move the ORIGINAL CALLER into the conference room
    // They will hear hold music until the agent joins.
    await client.calls(twilioCallSid).update({
      twiml: `
        <Response>
          <Dial>
            <Conference waitUrl="http://twimlets.com/holdmusic/S_Classic">${conferenceName}</Conference>
          </Dial>
        </Response>`
    });

    // 2. Call the HUMAN AGENT
    // We point them to the /api/confirm-agent-transfer endpoint
    await client.calls.create({
      to: destinationNumber,
      from: fromNumber!,
      twiml: `
        <Response>
          <Gather numDigits="1" action="${baseUrl}/api/confirm-agent-transfer?confName=${conferenceName}&amp;originalSid=${twilioCallSid}" timeout="15">
            <Say>Hello. You have a transfer request regarding: ${transferReason}. Press 1 to accept and connect to the caller.</Say>
          </Gather>
          <Say>I did not receive an input. Hanging up.</Say>
          <Hangup/>
        </Response>`
    });

    return {
      status: 'success',
      message: 'Warm transfer initiated. Caller is on hold in conference.',
      callDetails: {
        ultravoxCallId,
        destinationNumber,
        transferInitiated: new Date()
      }
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
