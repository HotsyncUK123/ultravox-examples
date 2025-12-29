import https from 'https';
import dotenv from 'dotenv';
import type { UltravoxCallConfig, UltravoxResponse, AgentTool } from './types.js';

// Get our environment variables from .env file
dotenv.config();

const DESTINATION_PHONE_NUMBER = process.env.DESTINATION_PHONE_NUMBER;
const ULTRAVOX_API_KEY = process.env.ULTRAVOX_API_KEY;
const SERVICE_API_KEY = process.env.SERVICE_API_KEY;

// Ultravox configuration
const ULTRAVOX_API_URL = 'https://api.ultravox.ai/api/calls';

// --- UPDATED SYSTEM PROMPT ---
const SYSTEM_PROMPT = `
Your name is Steve, a professional AI assistant. 

TRANSFER PROTOCOL:
1. If the user asks for a human, a manager, or has a complex request, you must transfer them.
2. Before triggering the tool, you MUST say: "I'll be happy to connect you with a specialist. Please stay on the line for a moment while I get them on the call."
3. Then, call the "transferCall" tool.
4. You must provide a clear "transferReason" (e.g., "Customer wants a refund" or "Billing inquiry").

Be helpful, concise, and polite.
`;

const getAgentTools = (baseUrl: string): AgentTool[] => {
    if (!DESTINATION_PHONE_NUMBER || !SERVICE_API_KEY) {
        throw new Error('DESTINATION_PHONE_NUMBER and SERVICE_API_KEY must be set');
    }

    return [
        {
            "temporaryTool": {
                "modelToolName": "transferCall",
                "description": "Transfers the call to a human agent. Use this when the user asks for a person or has a complex issue.",
                "requirements": {
                    "httpSecurityOptions": {
                        "options": [
                            {
                                "requirements": {
                                    "api_key_auth": {
                                        "headerApiKey": {
                                            "name": "X-API-Key"
                                        }
                                    }
                                }
                            }
                        ]
                    }
                },
                "automaticParameters": [
                    {
                        "name": "ultravoxCallId",
                        "location": "PARAMETER_LOCATION_BODY",
                        "knownValue": "KNOWN_PARAM_CALL_ID"
                    }
                ],
                "staticParameters": [
                    {
                        "name": "destinationNumber",
                        "location": "PARAMETER_LOCATION_BODY",
                        "value": DESTINATION_PHONE_NUMBER
                    },
                    {
                        "name": "useWhisper",
                        "location": "PARAMETER_LOCATION_BODY",
                        "value": true
                    }
                ],
                "dynamicParameters": [
                    {
                        "name": "firstName",
                        "location": "PARAMETER_LOCATION_BODY",
                        "schema": {
                            "description": "The caller's first name",
                            "type": "string",
                        },
                        "required": false,
                    },
                    {
                        "name": "lastName",
                        "location": "PARAMETER_LOCATION_BODY",
                        "schema": {
                            "description": "The caller's last name",
                            "type": "string",
                        },
                        "required": false,
                    },
                    {
                        "name": "transferReason",
                        "location": "PARAMETER_LOCATION_BODY",
                        "schema": {
                            "description": "A brief summary of why the call is being transferred.",
                            "type": "string",
                        },
                        "required": true,
                    },
                ],
                "http": {
                    "baseUrlPattern": `${baseUrl}/api/transfer`,
                    "httpMethod": "POST",
                },
            },
            "authTokens": {
                "api_key_auth": SERVICE_API_KEY
            },
        }
    ];
}

const getUltravoxCallConfig = (baseUrl: string): UltravoxCallConfig => {
    const selectedTools = getAgentTools(baseUrl);
    return {
        systemPrompt: SYSTEM_PROMPT,
        model: 'fixie-ai/ultravox',
        voice: 'Mark',
        temperature: 0.3,
        firstSpeakerSettings: { user: {} },
        selectedTools: selectedTools,
        medium: { twilio: {} }
    };
};

export async function createUltravoxCall(baseUrl: string): Promise<UltravoxResponse> {
    if (!ULTRAVOX_API_KEY) {
        throw new Error('ULTRAVOX_API_KEY must be set');
    }

    const callConfig = getUltravoxCallConfig(baseUrl);
    console.log('Creating Ultravox call with Twilio as medium...');
    
    const request = https.request(ULTRAVOX_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': ULTRAVOX_API_KEY
        }
    });

    return new Promise((resolve, reject) => {
        let data = '';

        request.on('response', (response) => {
            console.log(`Ultravox API response status: ${response.statusCode} ${response.statusMessage}`);
            
            response.on('data', chunk => {
                data += chunk;
            });
            
            response.on('end', () => {
                try {
                    const parsedData = JSON.parse(data) as UltravoxResponse;
                    if (response.statusCode && response.statusCode >= 400) {
                        reject(new Error(`API request failed: ${JSON.stringify(parsedData)}`));
                    } else {
                        resolve(parsedData);
                    }
                } catch (error) {
                    reject(new Error(`Failed to parse response: ${data}`));
                }
            });
        });

        request.on('error', (error: Error) => {
            reject(error);
        });

        request.write(JSON.stringify(callConfig));
        request.end();
    });
}
