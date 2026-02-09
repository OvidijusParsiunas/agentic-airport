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
  alignedWithRunway: boolean;
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
  const dx = plane.position.x - airport.runwayStart.x;
  const dy = plane.position.y - airport.runwayStart.y;
  const runwayAngle = Math.atan2(
    airport.runwayEnd.y - airport.runwayStart.y,
    airport.runwayEnd.x - airport.runwayStart.x
  );
  const localX = dx * Math.cos(-runwayAngle) - dy * Math.sin(-runwayAngle);
  const localY = dx * Math.sin(-runwayAngle) + dy * Math.cos(-runwayAngle);
  const onRunway = localX >= 0 && localX <= runwayLength && Math.abs(localY) <= airport.runwayWidth / 2;

  // Check if aligned with runway (heading ~0° or ~180° for horizontal runway)
  const headingDiff = Math.abs(normalizeAngle(plane.heading) - normalizeAngle(airport.runwayHeading));
  const reverseHeadingDiff = Math.abs(normalizeAngle(plane.heading) - normalizeAngle(airport.runwayHeading + 180));
  const alignedWithRunway = Math.min(headingDiff, 360 - headingDiff) < 25 || Math.min(reverseHeadingDiff, 360 - reverseHeadingDiff) < 25;

  return {
    distanceToRunway,
    headingToRunwayCenter,
    onRunway,
    alignedWithRunway,
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
- headingToRunway: The heading to fly TOWARD the runway center
- distanceToRunway: Distance in pixels to runway center
- onRunway: true if plane is currently over the runway
- alignedWithRunway: true if heading is ~0° or ~180°

### Step-by-step to land a plane:

1. **NAVIGATE TO RUNWAY**: Turn plane to "headingToRunway" to fly toward the runway
2. **ALIGN FOR LANDING**: When distanceToRunway < 150px, turn to a landing heading:
   - Use heading 0° if approaching from the LEFT (plane.x < runwayCenter.x)
   - Use heading 180° if approaching from the RIGHT (plane.x > runwayCenter.x)
3. **SET APPROACH**: Once aligned (alignedWithRunway=true) AND close (distanceToRunway < 100), issue "approach" command
4. **PLANE LANDS AUTOMATICALLY** when: status=approaching + onRunway=true + alignedWithRunway=true + speed<0.5

## COMMANDS:
- turn: Set heading (0=right, 90=down, 180=left, 270=up)
- speed: Set speed (0.15 to 0.8, use ≤0.3 for landing)
- approach: Mark as approaching (ONLY when aligned and close!)
- hold: Circle in place (+2° heading, -5% speed)

## COLLISION AVOIDANCE:
- Check "collisionRisks" array - HIGH risk means immediate action needed
- If predictedDistance < 60px, turn one plane away or slow it down

## IMPORTANT:
- You MUST actively turn planes toward the runway using "headingToRunway"
- The "approach" command does NOT change the plane's direction - YOU must turn it first!
- Issue commands every update cycle - planes need continuous guidance

Respond with JSON:
{
  "commands": [
    { "planeId": "plane-1", "action": "turn", "value": 180 },
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
          distanceToRunway: nav.distanceToRunway,
          headingToRunway: nav.headingToRunwayCenter,
          onRunway: nav.onRunway,
          alignedWithRunway: nav.alignedWithRunway,
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
      landingHeadings: [airport.runwayHeading, normalizeAngle(airport.runwayHeading + 180)],
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
