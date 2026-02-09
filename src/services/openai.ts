import { isInApproachZone, APPROACH_ZONE_LENGTH } from '../utils/geometry';
import { Plane, Airport, AIResponse, Position } from '../types/game';

const FRAMES_PER_SECOND = 60;
const AI_UPDATE_INTERVAL_SECONDS = 5;
const FRAMES_UNTIL_NEXT_UPDATE = FRAMES_PER_SECOND * AI_UPDATE_INTERVAL_SECONDS; // 300 frames

function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

function normalizeAngle(angle: number): number {
  let a = angle % 360;
  if (a < 0) a += 360;
  return a;
}

function predictPosition(position: Position, heading: number, speed: number): Position {
  const rad = degToRad(heading);
  const distance = speed * FRAMES_UNTIL_NEXT_UPDATE;
  return {
    x: Math.round(position.x + Math.cos(rad) * distance),
    y: Math.round(position.y + Math.sin(rad) * distance),
  };
}

function calculateDistance(p1: Position, p2: Position): number {
  return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
}

function calculateHeadingTo(from: Position, to: Position): number {
  const rad = Math.atan2(to.y - from.y, to.x - from.x);
  return normalizeAngle(radToDeg(rad));
}

interface NavigationData {
  distanceToRunway: number;
  headingToRunwayCenter: number;
  onRunway: boolean;
  alignedForLanding: boolean;
  // Approach zone data (planes must approach from left)
  headingToApproachZone: number;
  distanceToApproachZone: number;
  inApproachZone: boolean;
}

function calculateNavigationData(plane: Plane, airport: Airport): NavigationData {
  // Runway center is midpoint between start and end
  const runwayCenter: Position = {
    x: (airport.runwayStart.x + airport.runwayEnd.x) / 2,
    y: (airport.runwayStart.y + airport.runwayEnd.y) / 2,
  };

  const distanceToRunway = Math.round(calculateDistance(plane.position, runwayCenter));
  const headingToRunwayCenter = Math.round(calculateHeadingTo(plane.position, runwayCenter));

  // Check if on runway (within runway rectangle)
  const runwayLength = calculateDistance(airport.runwayStart, airport.runwayEnd);
  const runwayAngle = Math.atan2(
    airport.runwayEnd.y - airport.runwayStart.y,
    airport.runwayEnd.x - airport.runwayStart.x
  );

  const dx = plane.position.x - airport.runwayStart.x;
  const dy = plane.position.y - airport.runwayStart.y;
  const localX = dx * Math.cos(-runwayAngle) - dy * Math.sin(-runwayAngle);
  const localY = dx * Math.sin(-runwayAngle) + dy * Math.cos(-runwayAngle);
  const onRunway = localX >= 0 && localX <= runwayLength && Math.abs(localY) <= airport.runwayWidth / 2;

  // Check if aligned for landing (heading ~0° ONLY - must approach from left)
  const headingDiff = Math.abs(normalizeAngle(plane.heading) - normalizeAngle(airport.runwayHeading));
  const alignedForLanding = Math.min(headingDiff, 360 - headingDiff) < 25;

  // Approach zone: corridor extending LEFT from runway start (where green lights are)
  const approachZoneEntry: Position = {
    x: airport.runwayStart.x - Math.cos(runwayAngle) * APPROACH_ZONE_LENGTH,
    y: airport.runwayStart.y - Math.sin(runwayAngle) * APPROACH_ZONE_LENGTH,
  };

  const distanceToApproachZone = Math.round(calculateDistance(plane.position, approachZoneEntry));
  const headingToApproachZone = Math.round(calculateHeadingTo(plane.position, approachZoneEntry));

  // Use shared function to check if in approach zone
  const inApproachZone = isInApproachZone(
    plane.position,
    airport.runwayStart,
    airport.runwayEnd,
    airport.runwayWidth
  );

  return {
    distanceToRunway,
    headingToRunwayCenter,
    onRunway,
    alignedForLanding,
    headingToApproachZone,
    distanceToApproachZone,
    inApproachZone,
  };
}

interface CollisionRisk {
  plane1: string;
  plane2: string;
  currentDistance: number;
  predictedDistance: number;
  riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
}

function assessCollisionRisks(planes: Plane[]): CollisionRisk[] {
  const risks: CollisionRisk[] = [];

  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      const p1 = planes[i];
      const p2 = planes[j];

      const currentDist = calculateDistance(p1.position, p2.position);
      const predicted1 = predictPosition(p1.position, p1.heading, p1.speed);
      const predicted2 = predictPosition(p2.position, p2.heading, p2.speed);
      const predictedDist = calculateDistance(predicted1, predicted2);

      let riskLevel: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
      if (predictedDist < 30 || currentDist < 50) {
        riskLevel = 'HIGH';
      } else if (predictedDist < 60 || currentDist < 80) {
        riskLevel = 'MEDIUM';
      }

      if (riskLevel !== 'LOW') {
        risks.push({
          plane1: p1.id,
          plane2: p2.id,
          currentDistance: Math.round(currentDist),
          predictedDistance: Math.round(predictedDist),
          riskLevel,
        });
      }
    }
  }

  return risks.sort((a, b) => {
    const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return order[a.riskLevel] - order[b.riskLevel];
  });
}

const SYSTEM_PROMPT = `You are an AI air traffic controller. Land planes safely without collisions.

## LANDING PROCEDURE (CRITICAL - follow these steps exactly):

Each plane has "navigation" data:
- headingToApproachZone: The heading to fly to reach the approach zone (LEFT of runway)
- distanceToApproachZone: Distance in pixels to the approach zone entry point
- inApproachZone: true if plane is in the green approach corridor (left of runway)
- distanceToRunway: Distance in pixels to runway center
- onRunway: true if plane is currently over the runway
- alignedForLanding: true if heading is ~0° (the ONLY valid landing direction)

### IMPORTANT: Planes MUST land from the LEFT side only!
- The runway has green approach lights on the LEFT side
- Planes MUST fly through the approach zone (left of runway) with heading ~0° (flying RIGHT)
- Landing with heading 180° (from right) is NOT ALLOWED

### Step-by-step to land a plane:

1. **POSITION FOR APPROACH**: If plane is NOT in approach zone, turn to "headingToApproachZone" to reach the left side of the runway
2. **ENTER APPROACH ZONE**: When inApproachZone=true, turn to heading 0° (flying right toward runway)
3. **SET APPROACH MODE**: Once heading ~0° AND in approach zone, issue "approach" command
4. **PLANE LANDS AUTOMATICALLY** when: status=approaching + onRunway=true + heading~0° + speed<0.5

## COMMANDS:
- turn: Set heading (0=right, 90=down, 180=left, 270=up)
- speed: Set speed (0.15 to 0.8, use ≤0.3 for landing)
- approach: Mark as approaching (ONLY when aligned at ~0° heading and in approach zone!)
- hold: Circle in place (+2° heading, -5% speed)

## COLLISION AVOIDANCE:
- Check "collisionRisks" array - HIGH risk means immediate action needed
- If predictedDistance < 60px, turn one plane away or slow it down

## IMPORTANT:
- Planes MUST approach from the LEFT (follow the green approach lights)
- The ONLY valid landing heading is ~0° (flying right)
- Guide planes to position LEFT of runway first, then turn to heading 0° to land
- The "approach" command does NOT change the plane's direction - YOU must turn it first!

Respond with JSON:
{
  "commands": [
    { "planeId": "plane-1", "action": "turn", "value": 0 },
    { "planeId": "plane-2", "action": "speed", "value": 0.3 }
  ],
  "reasoning": "Brief explanation"
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

  const collisionRisks = assessCollisionRisks(activePlanes);

  const runwayCenter: Position = {
    x: (airport.runwayStart.x + airport.runwayEnd.x) / 2,
    y: (airport.runwayStart.y + airport.runwayEnd.y) / 2,
  };

  const gameState = {
    planes: activePlanes.map(p => {
      const nav = calculateNavigationData(p, airport);
      return {
        id: p.id,
        callsign: p.callsign,
        position: { x: Math.round(p.position.x), y: Math.round(p.position.y) },
        predictedPosition: predictPosition(p.position, p.heading, p.speed),
        heading: Math.round(p.heading),
        speed: p.speed.toFixed(2),
        status: p.status,
        navigation: {
          // Approach zone data (planes MUST approach from left)
          headingToApproachZone: nav.headingToApproachZone,
          distanceToApproachZone: nav.distanceToApproachZone,
          inApproachZone: nav.inApproachZone,
          // Runway data
          distanceToRunway: nav.distanceToRunway,
          onRunway: nav.onRunway,
          alignedForLanding: nav.alignedForLanding, // true if heading ~0° (the ONLY valid landing direction)
        },
      };
    }),
    collisionRisks: collisionRisks.length > 0 ? collisionRisks : undefined,
    airport: {
      runwayCenter: { x: Math.round(runwayCenter.x), y: Math.round(runwayCenter.y) },
      runwayStart: airport.runwayStart,
      runwayEnd: airport.runwayEnd,
      runwayHeading: airport.runwayHeading,
      runwayWidth: airport.runwayWidth,
      validLandingHeading: airport.runwayHeading, // ONLY heading ~0° is valid (approach from left)
      approachZoneLength: APPROACH_ZONE_LENGTH,
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
