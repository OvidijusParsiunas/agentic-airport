import { isInApproachZone, APPROACH_ZONE_LENGTH } from '../utils/geometry';
import { Plane, Airport, AIResponse, SinglePlaneAIResponse, Position, SharedContext } from '../types/game';

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

const PILOT_SYSTEM_PROMPT = `You are an AI pilot controlling a single aircraft. Your job is to safely land YOUR plane while coordinating with other aircraft to avoid collisions.

## YOUR ASSIGNED PLANE
You control ONLY the plane marked as "yourPlane" in the game state. Do NOT try to control other planes.

## CRITICAL: LANDING QUEUE COORDINATION
You will receive a "sharedContext" object containing:
- **landingQueue**: Priority list showing who should land in what order (priority 1 = first to land)
- **recentDecisions**: What other pilots decided last round - use this to predict their behavior
- **coordinationNote**: Important coordination message to follow

### LANDING QUEUE RULES (MUST FOLLOW):
1. **ONLY Priority 1 may fly toward the runway**. All others MUST fly AWAY.
2. If another plane is already "approaching" status, DO NOT start your approach
3. Only ONE plane should be on final approach at a time
4. **If you are Priority 2+, you MUST turn to heading 180° (fly LEFT) immediately**
5. Priority 2 should hold in UPPER-LEFT area (y < 200, x < 300)
6. Priority 3+ should hold in LOWER-LEFT area (y > 400, x < 300)
7. Check "recentDecisions" - if another pilot is approaching, maintain distance

## HOLDING/WAITING STRATEGIES:
**If you are NOT priority 1, use the "hold" command or turn away from the runway:**

1. **"hold" command is now effective** - it turns you toward heading 180° (left, away from runway) and slows you down
2. **If near other waiting planes**, use explicit turn commands to separate:
   - Upper half (y < 300): turn to heading 225° or 270° (fly left-down or up)
   - Lower half (y > 300): turn to heading 135° or 90° (fly left-up or down)
3. **Maintain distance**: Stay at least 200px away from other planes
4. **Runway is on the RIGHT (x ≈ 600)** - waiting planes should stay on the LEFT (x < 400)

## LANDING PROCEDURE (only when you are priority 1 and no one else is approaching):

Your plane has "navigation" data:
- headingToApproachZone: The heading to fly to reach the approach zone (LEFT of runway)
- distanceToApproachZone: Distance in pixels to the approach zone entry point
- inApproachZone: true if plane is in the green approach corridor (left of runway)
- distanceToRunway: Distance in pixels to runway center
- onRunway: true if plane is currently over the runway
- alignedForLanding: true if heading is ~0° (the ONLY valid landing direction)

### IMPORTANT: You MUST land from the LEFT side only!
- The runway has green approach lights on the LEFT side
- You MUST fly through the approach zone (left of runway) with heading ~0° (flying RIGHT)
- Landing with heading 180° (from right) is NOT ALLOWED

### Step-by-step to land (ONLY if you are priority 1):

1. **POSITION FOR APPROACH**: If NOT in approach zone, turn to "headingToApproachZone" to reach the left side of the runway
2. **ENTER APPROACH ZONE**: When inApproachZone=true, turn to heading 0° (flying right toward runway)
3. **SET APPROACH MODE**: Once heading ~0° AND in approach zone, issue "approach" command
4. **LAND**: Your plane lands automatically when: status=approaching + onRunway=true + heading~0° + speed<0.5

## COMMANDS (for YOUR plane only):
- turn: Set heading (0=right, 90=down, 180=left, 270=up)
- speed: Set speed (0.15 to 0.8, use ≤0.3 for landing)
- approach: Mark as approaching (ONLY when aligned at ~0° heading and in approach zone AND you are priority 1!)
- hold: **GOOD FOR WAITING** - Turns plane toward heading 180° (away from runway) and slows to 0.2

## COLLISION AVOIDANCE:
- Check "collisionRisks" array for threats involving YOUR plane
- If another plane is too close, turn away or adjust speed
- You are responsible for YOUR plane's safety - other pilots control their own planes

Respond with JSON (command for YOUR plane only):

Example for Priority 1 (proceeding to land):
{
  "command": { "action": "turn", "value": 0 },
  "reasoning": "P1: Turning to approach zone heading for landing"
}

Example for Priority 2+ (MUST wait - use hold to fly away!):
{
  "command": { "action": "hold" },
  "reasoning": "P2: Holding - turning away from runway while P1 lands"
}

Example for separating from another waiting plane:
{
  "command": { "action": "turn", "value": 270 },
  "reasoning": "P3: Turning UP to separate from P2 who is also waiting"
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

  const userMessage = `Current game state:\n${JSON.stringify(gameState, null, 2)}\n\nAnalyze the situation and provide commands for the planes. Remember to prevent collisions and sequence landings properly. Respond with JSON.`;

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
        input: userMessage,
        temperature: 0.3,
        max_output_tokens: 1000,
        text: {
          format: { type: 'json_object' },
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'API request failed');
    }

    const data = await response.json();
    const content = data.output[0].content[0].text;
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

export async function getPlaneAgentCommand(
  apiKey: string,
  assignedPlane: Plane,
  allPlanes: Plane[],
  airport: Airport,
  canvasWidth: number,
  canvasHeight: number,
  sharedContext?: SharedContext
): Promise<SinglePlaneAIResponse> {
  const activePlanes = allPlanes.filter(p => p.status !== 'landed' && p.status !== 'crashed');

  // Get collision risks involving this plane
  const allRisks = assessCollisionRisks(activePlanes);
  const relevantRisks = allRisks.filter(
    r => r.plane1 === assignedPlane.id || r.plane2 === assignedPlane.id
  );

  const runwayCenter: Position = {
    x: (airport.runwayStart.x + airport.runwayEnd.x) / 2,
    y: (airport.runwayStart.y + airport.runwayEnd.y) / 2,
  };

  // Find this plane's priority in the landing queue
  const myQueueEntry = sharedContext?.landingQueue.find(e => e.planeId === assignedPlane.id);
  const myPriority = myQueueEntry?.priority ?? 999;

  // Build game state with assigned plane highlighted
  const gameState = {
    yourPlane: (() => {
      const nav = calculateNavigationData(assignedPlane, airport);
      return {
        id: assignedPlane.id,
        callsign: assignedPlane.callsign,
        position: { x: Math.round(assignedPlane.position.x), y: Math.round(assignedPlane.position.y) },
        predictedPosition: predictPosition(assignedPlane.position, assignedPlane.heading, assignedPlane.speed),
        heading: Math.round(assignedPlane.heading),
        speed: assignedPlane.speed.toFixed(2),
        status: assignedPlane.status,
        yourPriority: myPriority, // Your position in landing queue (1 = you should land first)
        navigation: {
          headingToApproachZone: nav.headingToApproachZone,
          distanceToApproachZone: nav.distanceToApproachZone,
          inApproachZone: nav.inApproachZone,
          distanceToRunway: nav.distanceToRunway,
          onRunway: nav.onRunway,
          alignedForLanding: nav.alignedForLanding,
        },
      };
    })(),
    otherPlanes: activePlanes
      .filter(p => p.id !== assignedPlane.id)
      .map(p => {
        const otherQueueEntry = sharedContext?.landingQueue.find(e => e.planeId === p.id);
        return {
          id: p.id,
          callsign: p.callsign,
          position: { x: Math.round(p.position.x), y: Math.round(p.position.y) },
          predictedPosition: predictPosition(p.position, p.heading, p.speed),
          heading: Math.round(p.heading),
          speed: p.speed.toFixed(2),
          status: p.status,
          priority: otherQueueEntry?.priority ?? 999, // Their position in landing queue
        };
      }),
    collisionRisks: relevantRisks.length > 0 ? relevantRisks : undefined,
    // Shared context for coordination
    sharedContext: sharedContext ? {
      coordinationNote: sharedContext.coordinationNote,
      landingQueue: sharedContext.landingQueue.map(e => ({
        callsign: e.callsign,
        priority: e.priority,
        isOnApproach: e.isOnApproach,
        distanceToRunway: e.distanceToRunway,
      })),
      recentDecisions: sharedContext.recentDecisions.map(d => ({
        callsign: d.callsign,
        action: d.action,
        reasoning: d.reasoning,
      })),
    } : undefined,
    airport: {
      runwayCenter: { x: Math.round(runwayCenter.x), y: Math.round(runwayCenter.y) },
      runwayStart: airport.runwayStart,
      runwayEnd: airport.runwayEnd,
      runwayHeading: airport.runwayHeading,
      runwayWidth: airport.runwayWidth,
      validLandingHeading: airport.runwayHeading,
      approachZoneLength: APPROACH_ZONE_LENGTH,
    },
    canvasSize: { width: canvasWidth, height: canvasHeight },
  };

  const priorityMessage = myPriority === 1
    ? "You are PRIORITY 1 - you should proceed to land (if safe)."
    : `You are PRIORITY ${myPriority} - you should WAIT and hold position until planes ahead of you land.`;

  const userMessage = `You are the pilot of ${assignedPlane.callsign} (ID: ${assignedPlane.id}).

${priorityMessage}

Current situation:
${JSON.stringify(gameState, null, 2)}

Decide your next action. Remember: If you are not priority 1, you should hold or slow down to let others land first. Respond with JSON.`;

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        instructions: PILOT_SYSTEM_PROMPT,
        input: userMessage,
        temperature: 0.3,
        max_output_tokens: 500,
        text: {
          format: { type: 'json_object' },
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'API request failed');
    }

    const data = await response.json();
    const content = data.output[0].content[0].text;
    const parsed = JSON.parse(content) as { command: { action: string; value?: number } | null; reasoning?: string };

    // Add planeId to the command if present
    const command = parsed.command
      ? { planeId: assignedPlane.id, action: parsed.command.action as 'turn' | 'speed' | 'hold' | 'approach', value: parsed.command.value }
      : null;

    return {
      command,
      reasoning: parsed.reasoning || 'No reasoning provided.',
    };
  } catch (error) {
    console.error(`OpenAI API error for ${assignedPlane.callsign}:`, error);
    throw error;
  }
}

export function validateApiKey(apiKey: string): boolean {
  return apiKey.startsWith('sk-') && apiKey.length > 20;
}

// Helper to build landing queue based on current plane states
export function buildLandingQueue(planes: Plane[], airport: Airport): SharedContext['landingQueue'] {
  const activePlanes = planes.filter(p => p.status !== 'landed' && p.status !== 'crashed');

  const queueEntries = activePlanes.map(plane => {
    const nav = calculateNavigationData(plane, airport);
    return {
      planeId: plane.id,
      callsign: plane.callsign,
      distanceToRunway: nav.distanceToRunway,
      isOnApproach: plane.status === 'approaching',
      isInApproachZone: nav.inApproachZone,
    };
  });

  // Sort by priority:
  // 1. Planes already approaching (highest priority)
  // 2. Planes in approach zone but not yet approaching
  // 3. Others sorted by distance to runway (closer = higher priority)
  queueEntries.sort((a, b) => {
    // Approaching planes always first
    if (a.isOnApproach && !b.isOnApproach) return -1;
    if (!a.isOnApproach && b.isOnApproach) return 1;

    // Then planes in approach zone
    if (a.isInApproachZone && !b.isInApproachZone) return -1;
    if (!a.isInApproachZone && b.isInApproachZone) return 1;

    // Then by distance (closer first)
    return a.distanceToRunway - b.distanceToRunway;
  });

  // Assign priorities (1 = first to land)
  return queueEntries.map((entry, index) => ({
    ...entry,
    priority: index + 1,
  }));
}

// Build coordination note based on current state
export function buildCoordinationNote(landingQueue: SharedContext['landingQueue']): string {
  const approaching = landingQueue.filter(e => e.isOnApproach);
  const inZone = landingQueue.filter(e => e.isInApproachZone && !e.isOnApproach);

  if (approaching.length > 0) {
    const names = approaching.map(e => e.callsign).join(', ');
    return `${names} is on FINAL APPROACH. All other aircraft MUST hold and maintain separation.`;
  }

  if (inZone.length > 0) {
    const first = landingQueue[0];
    return `${first.callsign} has landing priority. Other aircraft should hold or slow down.`;
  }

  if (landingQueue.length > 0) {
    const first = landingQueue[0];
    return `${first.callsign} is closest to runway and has landing priority.`;
  }

  return 'No aircraft in queue.';
}
