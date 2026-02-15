import { isInApproachZone, isOverAirport, distance, normalizeAngle, APPROACH_ZONE_LENGTH, predictCollision, detectTailCollision, wrappedHeadingTo, wrappedDistance } from '../utils/geometry';
import { Plane, Airport, AIResponse, Position, ConversationMessage } from '../types/game';

interface NavigationData {
  headingToApproachEntry: number;  // Heading to approach zone entry (use when far away)
  distanceToApproachEntry: number; // Distance to approach entry point
  headingToRunway: number;         // Direct heading to runway center (use when in/near approach zone)
  inApproachZone: boolean;
  distanceToRunway: number;
  onRunway: boolean;
  alignedForLanding: boolean;
  overAirportZone: boolean;
}

function calculateNavigationData(plane: Plane, airport: Airport, canvasWidth: number, canvasHeight: number): NavigationData {
  const runwayCenter: Position = {
    x: (airport.runwayStart.x + airport.runwayEnd.x) / 2,
    y: (airport.runwayStart.y + airport.runwayEnd.y) / 2,
  };

  // Use wrapped distance to account for canvas wrap-around
  const distanceToRunway = Math.round(wrappedDistance(plane.position, runwayCenter, canvasWidth, canvasHeight));

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

  // Approach zone entry point (300px behind runway start)
  const approachZoneEntry: Position = {
    x: airport.runwayStart.x - Math.cos(runwayAngle) * APPROACH_ZONE_LENGTH,
    y: airport.runwayStart.y - Math.sin(runwayAngle) * APPROACH_ZONE_LENGTH,
  };

  const inApproachZone = isInApproachZone(plane.position, airport.runwayStart, airport.runwayEnd, airport.runwayWidth);

  // Check alignment: heading must match runway
  const headingDiff = Math.abs(normalizeAngle(plane.heading) - normalizeAngle(airport.runwayHeading));
  const headingMatchesRunway = Math.min(headingDiff, 360 - headingDiff) < 25;

  // Only report "aligned for landing" if plane is actually in the approach zone
  // This prevents confusing the AI when a plane happens to have heading ~0° but is far away
  const alignedForLanding = inApproachZone && headingMatchesRunway;

  return {
    distanceToRunway,
    // Use wrapped heading/distance to account for canvas wrap-around
    headingToApproachEntry: Math.round(wrappedHeadingTo(plane.position, approachZoneEntry, canvasWidth, canvasHeight)),
    distanceToApproachEntry: Math.round(wrappedDistance(plane.position, approachZoneEntry, canvasWidth, canvasHeight)),
    headingToRunway: Math.round(wrappedHeadingTo(plane.position, runwayCenter, canvasWidth, canvasHeight)),
    inApproachZone,
    onRunway,
    alignedForLanding,
    overAirportZone: isOverAirport(plane.position, airport.runwayStart, airport.runwayEnd, airport.runwayWidth),
  };
}

interface CollisionRisk {
  plane1: string;
  plane2: string;
  currentDistance: number;
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  riskType: 'proximity' | 'predicted' | 'tail_catch_up';
  details?: string;
}

function assessCollisionRisks(planes: Plane[], canvasWidth: number, canvasHeight: number): CollisionRisk[] {
  const risks: CollisionRisk[] = [];

  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      const p1 = planes[i];
      const p2 = planes[j];
      // Use wrapped distance to account for canvas wrap-around
      const currentDist = wrappedDistance(p1.position, p2.position, canvasWidth, canvasHeight);

      // Immediate proximity risk
      if (currentDist < 60) {
        risks.push({
          plane1: p1.id,
          plane2: p2.id,
          currentDistance: Math.round(currentDist),
          riskLevel: currentDist < 40 ? 'CRITICAL' : 'HIGH',
          riskType: 'proximity',
        });
        continue; // Don't add duplicate risks for the same pair
      }

      // Predictive collision detection
      const prediction = predictCollision(p1, p2, canvasWidth, canvasHeight, 300, 30); // 5 second horizon
      if (prediction.willCollide) {
        risks.push({
          plane1: p1.id,
          plane2: p2.id,
          currentDistance: Math.round(currentDist),
          riskLevel: prediction.framesUntilCollision < 120 ? 'HIGH' : 'MEDIUM',
          riskType: 'predicted',
          details: `Collision predicted in ~${Math.round(prediction.framesUntilCollision / 60)}s`,
        });
        continue;
      }

      // Tail/catch-up collision detection (faster plane behind slower plane)
      const tailRisk = detectTailCollision(p1, p2, canvasWidth, canvasHeight, 45);
      if (tailRisk.isRisk && tailRisk.fasterPlane && tailRisk.slowerPlane) {
        risks.push({
          plane1: tailRisk.fasterPlane.id,
          plane2: tailRisk.slowerPlane.id,
          currentDistance: Math.round(currentDist),
          riskLevel: tailRisk.catchUpTime < 5 ? 'HIGH' : 'MEDIUM',
          riskType: 'tail_catch_up',
          details: `${tailRisk.fasterPlane.id} (speed ${tailRisk.fasterPlane.speed.toFixed(2)}) catching up to ${tailRisk.slowerPlane.id} (speed ${tailRisk.slowerPlane.speed.toFixed(2)}) in ~${tailRisk.catchUpTime}s. SLOW DOWN the faster plane or SPEED UP the slower plane.`,
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

## COLLISION AVOIDANCE (HIGHEST PRIORITY)
When collisionRisks is present in the game state, you MUST address them IMMEDIATELY:
- **CRITICAL/HIGH proximity**: Planes are dangerously close. Turn one plane away (add 90° to heading) OR slow one down.
- **predicted**: Planes will collide if they maintain current course. Change heading or speed of at least one plane.
- **tail_catch_up**: A faster plane is catching up to a slower plane on a similar heading. Either SLOW DOWN the faster plane or SPEED UP the slower plane to maintain separation. This is common when planes are "idle" - always check relative speeds!

IMPORTANT: If two planes are flying in the same direction, ensure the plane behind is NOT faster than the plane ahead. Match speeds or separate them.

## NAVIGATION DATA
- headingToApproachEntry: Heading to approach zone entry point (use when NOT in approach zone)
- headingToRunway: Direct heading to runway center
- inApproachZone: True when plane is in the landing corridor
- alignedForLanding: True when heading is within 25° of runway heading (0°)

## LANDING STEPS
1. When inApproachZone=false: Turn toward headingToApproachEntry to reach the approach zone
2. When inApproachZone=true: Turn to runway heading (0°) - DO NOT use headingToApproachEntry (it points backward!)
3. When inApproachZone=true AND alignedForLanding=true (heading ~0°), issue "approach"
4. Once "approaching": maintain heading ~0° and speed ≤0.3. Do NOT change course.
5. Plane lands automatically when: approaching + onRunway + speed<0.5

## COMMANDS
- turn: Set heading (0=right, 90=down, 180=left, 270=up)
- speed: Set speed (0.15-0.8, use ≤0.3 for landing)
- approach: Mark as approaching (only when in approach zone + aligned)
- hold: Turn toward 180° and slow down (ONLY for "flying" planes that need to wait)

## CRITICAL
- NEVER issue "hold" or "turn" to an "approaching" plane. Let it land.
- Ignore "overAirportZone" for approaching planes - they are allowed there.
- When inApproachZone=true, ALWAYS turn to heading 0° (runway heading), NEVER turn away from runway.

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

  const collisionRisks = assessCollisionRisks(activePlanes, canvasWidth, canvasHeight);

  const gameState = {
    planes: activePlanes.map(p => {
      const nav = calculateNavigationData(p, airport, canvasWidth, canvasHeight);
      console.log(`[DEBUG] ${p.callsign} nav:`, JSON.stringify(nav));
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
