import { Plane, Airport, AICommand, AIResponse } from '../types/game';

const SYSTEM_PROMPT = `You are an AI air traffic controller for a simple airport simulation game. Your goal is to safely land all planes without any collisions.

The airport has a single runway. Planes need to:
1. Approach the runway from the correct heading
2. Slow down when approaching
3. Land safely on the runway

You will receive the current state of all planes and the airport. You must respond with commands for each plane that needs direction.

Available commands:
- turn: Set a new heading (0-359 degrees). 0 = right, 90 = down, 180 = left, 270 = up
- speed: Set a new speed (0.5 to 3 pixels per frame)
- approach: Tell the plane to begin approach (it will aim for the runway)
- hold: Tell the plane to circle at current position

CRITICAL RULES:
1. PREVENT COLLISIONS: Keep planes at least 50 pixels apart
2. SEQUENCE LANDINGS: Only one plane should approach the runway at a time
3. CORRECT HEADING: Planes must approach the runway from the correct direction (runway heading ± 20 degrees)
4. MANAGE SPEED: Slow planes down as they approach

Respond with a JSON object containing:
{
  "commands": [
    { "planeId": "plane-1", "action": "turn", "value": 180 },
    { "planeId": "plane-2", "action": "speed", "value": 1.0 }
  ],
  "reasoning": "Brief explanation of your decisions"
}`;

export async function getAICommands(
  apiKey: string,
  planes: Plane[],
  airport: Airport,
  canvasWidth: number,
  canvasHeight: number
): Promise<AIResponse> {
  const activePlanes = planes.filter(p => p.status !== 'landed' && p.status !== 'crashed');

  if (activePlanes.length === 0) {
    return { commands: [], reasoning: 'No active planes to control.' };
  }

  const gameState = {
    planes: activePlanes.map(p => ({
      id: p.id,
      callsign: p.callsign,
      position: { x: Math.round(p.position.x), y: Math.round(p.position.y) },
      heading: Math.round(p.heading),
      speed: p.speed.toFixed(2),
      status: p.status,
    })),
    airport: {
      runwayStart: airport.runwayStart,
      runwayEnd: airport.runwayEnd,
      runwayHeading: airport.runwayHeading,
      runwayWidth: airport.runwayWidth,
    },
    canvasSize: { width: canvasWidth, height: canvasHeight },
  };

  const userMessage = `Current game state:\n${JSON.stringify(gameState, null, 2)}\n\nAnalyze the situation and provide commands for the planes. Remember to prevent collisions and sequence landings properly.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'API request failed');
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    const parsed = JSON.parse(content) as AIResponse;

    return {
      commands: parsed.commands || [],
      reasoning: parsed.reasoning || 'No reasoning provided.',
    };
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw error;
  }
}

export function validateApiKey(apiKey: string): boolean {
  return apiKey.startsWith('sk-') && apiKey.length > 20;
}
