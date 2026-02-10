import { isInApproachZone, isOverAirport, distance, normalizeAngle, APPROACH_ZONE_LENGTH } from '../utils/geometry';
import { Plane, Airport, AIResponse, Position, ConversationMessage } from '../types/game';

function calculateHeadingTo(from: Position, to: Position): number {
  const rad = Math.atan2(to.y - from.y, to.x - from.x);
  return normalizeAngle((rad * 180) / Math.PI);
}

interface NavigationData {
  headingToApproachZone: number;
  distanceToApproachZone: number;
  inApproachZone: boolean;
  distanceToRunway: number;
  onRunway: boolean;
  alignedForLanding: boolean;
  overAirportZone: boolean;
}

function calculateNavigationData(plane: Plane, airport: Airport): NavigationData {
  const runwayCenter: Position = {
    x: (airport.runwayStart.x + airport.runwayEnd.x) / 2,
    y: (airport.runwayStart.y + airport.runwayEnd.y) / 2,
  };

  const distanceToRunway = Math.round(distance(plane.position, runwayCenter));

  // Check if on runway
  const runwayLength = distance(airport.runwayStart, airport.runwayEnd);
  const runwayAngle = Math.atan2(
    airport.runwayEnd.y - airport.runwayStart.y,
    airport.runwayEnd.x - airport.runwayStart.x
  );

  const dx = plane.position.x - airport.runwayStart.x;
  const dy = plane.position.y - airport.runwayStart.y;
  const localX = dx * Math.cos(-runwayAngle) - dy * Math.sin(-runwayAngle);
  const localY = dx * Math.sin(-runwayAngle) + dy * Math.cos(-runwayAngle);
  const onRunway = localX >= 0 && localX <= runwayLength && Math.abs(localY) <= airport.runwayWidth / 2;

  // Check alignment (heading ~0°)
  const headingDiff = Math.abs(normalizeAngle(plane.heading) - normalizeAngle(airport.runwayHeading));
  const alignedForLanding = Math.min(headingDiff, 360 - headingDiff) < 25;

  // Approach zone entry point
  const approachZoneEntry: Position = {
    x: airport.runwayStart.x - Math.cos(runwayAngle) * APPROACH_ZONE_LENGTH,
    y: airport.runwayStart.y - Math.sin(runwayAngle) * APPROACH_ZONE_LENGTH,
  };

  return {
    distanceToRunway,
    headingToApproachZone: Math.round(calculateHeadingTo(plane.position, approachZoneEntry)),
    distanceToApproachZone: Math.round(distance(plane.position, approachZoneEntry)),
    inApproachZone: isInApproachZone(plane.position, airport.runwayStart, airport.runwayEnd, airport.runwayWidth),
    onRunway,
    alignedForLanding,
    overAirportZone: isOverAirport(plane.position, airport.runwayStart, airport.runwayEnd, airport.runwayWidth),
  };
}

interface CollisionRisk {
  plane1: string;
  plane2: string;
  currentDistance: number;
  riskLevel: 'HIGH' | 'MEDIUM';
}

function assessCollisionRisks(planes: Plane[]): CollisionRisk[] {
  const risks: CollisionRisk[] = [];

  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      const currentDist = distance(planes[i].position, planes[j].position);

      if (currentDist < 60) {
        risks.push({
          plane1: planes[i].id,
          plane2: planes[j].id,
          currentDistance: Math.round(currentDist),
          riskLevel: currentDist < 40 ? 'HIGH' : 'MEDIUM',
        });
      }
    }
  }

  return risks;
}

const SYSTEM_PROMPT = `You are an AI air traffic controller. Guide planes to land safely.

## KEY RULES
1. Planes with "flying" status CRASH if they enter the airport zone. Issue "approach" BEFORE they reach it.
2. Planes with "approaching" status are SAFE over the airport. They MUST continue straight to land - NEVER hold or turn away.
3. Only ONE plane approaches at a time. Others must hold/wait.
4. Planes land from the LEFT (heading ~0°).

## LANDING STEPS
1. Turn plane toward headingToApproachZone
2. When inApproachZone=true AND heading ~0°, issue "approach"
3. Once "approaching": maintain heading ~0° and speed ≤0.3. Do NOT change course.
4. Plane lands automatically when: approaching + onRunway + speed<0.5

## COMMANDS
- turn: Set heading (0=right, 90=down, 180=left, 270=up)
- speed: Set speed (0.15-0.8, use ≤0.3 for landing)
- approach: Mark as approaching (only when in approach zone + aligned)
- hold: Turn toward 180° and slow down (ONLY for "flying" planes that need to wait)

## CRITICAL
- NEVER issue "hold" or "turn" to an "approaching" plane. Let it land.
- Ignore "overAirportZone" for approaching planes - they are allowed there.

## RESPONSE FORMAT
{
  "commands": [{ "planeId": "plane-1", "action": "turn", "value": 0 }],
  "reasoning": "Brief explanation"
}`;

export async function getAICommands(
  apiKey: string,
  planes: Plane[],
  airport: Airport,
  canvasWidth: number,
  canvasHeight: number,
  conversationHistory: ConversationMessage[] = []
): Promise<{ response: AIResponse; newMessages: ConversationMessage[] }> {
  const activePlanes = planes.filter(p => p.status !== 'landed' && p.status !== 'crashed');

  if (activePlanes.length === 0) {
    return {
      response: { commands: [], reasoning: 'No active planes.' },
      newMessages: []
    };
  }

  const collisionRisks = assessCollisionRisks(activePlanes);

  const gameState = {
    planes: activePlanes.map(p => {
      const nav = calculateNavigationData(p, airport);
      return {
        id: p.id,
        callsign: p.callsign,
        position: { x: Math.round(p.position.x), y: Math.round(p.position.y) },
        heading: Math.round(p.heading),
        speed: Number(p.speed.toFixed(2)),
        status: p.status,
        navigation: nav,
      };
    }),
    collisionRisks: collisionRisks.length > 0 ? collisionRisks : undefined,
    airport: {
      runwayStart: airport.runwayStart,
      runwayEnd: airport.runwayEnd,
      runwayHeading: airport.runwayHeading,
    },
    canvasSize: { width: canvasWidth, height: canvasHeight },
  };

  const userMessage = `Game state:\n${JSON.stringify(gameState, null, 2)}\n\nProvide commands. JSON only.`;

  const input = [
    ...conversationHistory.map(msg => ({ role: msg.role, content: msg.content })),
    { role: 'user', content: userMessage },
  ];

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        instructions: SYSTEM_PROMPT,
        input,
        temperature: 0.3,
        max_output_tokens: 500,
        text: { format: { type: 'json_object' } },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'API request failed');
    }

    const data = await response.json();
    const messageOutput = data.output.find((item: { type: string }) => item.type === 'message');
    if (!messageOutput?.content?.[0]) {
      throw new Error('No message content in response');
    }

    const content = messageOutput.content[0].text;
    const parsed = JSON.parse(content) as AIResponse;

    return {
      response: {
        commands: parsed.commands || [],
        reasoning: parsed.reasoning || 'No reasoning provided.',
      },
      newMessages: [
        { role: 'user', content: userMessage },
        { role: 'assistant', content },
      ],
    };
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw error;
  }
}

export function validateApiKey(apiKey: string): boolean {
  return apiKey.startsWith('sk-') && apiKey.length > 20;
}
