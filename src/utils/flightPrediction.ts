import { normalizeAngle, isOverAirport, wrappedDistance } from './geometry';
import { Plane, Airport, GameConfig } from '../types/game';

// Predictive collision detection - checks if a plane with a new heading would collide with other planes
export interface CollisionPrediction {
  willCollide: boolean;
  collidingPlane?: Plane;
  timeToCollision?: number;
  collisionPoint?: { x: number; y: number };
}

export function predictCollision(
  plane: Plane,
  newHeading: number,
  allPlanes: Plane[],
  config: GameConfig,
  canvasWidth: number,
  canvasHeight: number,
  secondsAhead: number = 8
): CollisionPrediction {
  const fps = 60;
  const totalFrames = secondsAhead * fps;
  const checkInterval = 5; // Check every 5 frames for performance
  const collisionThreshold = 50; // Slightly larger than actual collision distance (30px) for safety margin

  const headingRad = (newHeading * Math.PI) / 180;
  const planeSpeed = plane.speed * config.gameSpeed;

  for (let frame = checkInterval; frame <= totalFrames; frame += checkInterval) {
    // Simulate this plane's position with the new heading
    const simX = plane.position.x + Math.cos(headingRad) * planeSpeed * frame;
    const simY = plane.position.y + Math.sin(headingRad) * planeSpeed * frame;

    // Check against all other active planes
    for (const other of allPlanes) {
      if (other.id === plane.id || other.status === 'crashed' || other.status === 'landed') {
        continue;
      }

      // Simulate other plane's position (assuming it continues on current heading)
      const otherHeadingRad = (other.heading * Math.PI) / 180;
      const otherSpeed = other.speed * config.gameSpeed;
      const otherSimX = other.position.x + Math.cos(otherHeadingRad) * otherSpeed * frame;
      const otherSimY = other.position.y + Math.sin(otherHeadingRad) * otherSpeed * frame;

      // Calculate distance between simulated positions using wrapped distance
      const dist = wrappedDistance(
        { x: simX, y: simY },
        { x: otherSimX, y: otherSimY },
        canvasWidth,
        canvasHeight
      );

      if (dist < collisionThreshold) {
        return {
          willCollide: true,
          collidingPlane: other,
          timeToCollision: frame / fps,
          collisionPoint: { x: simX, y: simY },
        };
      }
    }
  }

  return { willCollide: false };
}

// Find a safe alternative heading that avoids collision
export function findSafeHeading(
  plane: Plane,
  requestedHeading: number,
  allPlanes: Plane[],
  config: GameConfig,
  canvasWidth: number,
  canvasHeight: number
): number | null {
  // Try adjustments in both directions, starting small
  const adjustments = [30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180];

  for (const adjustment of adjustments) {
    const alternativeHeading = normalizeAngle(requestedHeading + adjustment);
    const prediction = predictCollision(plane, alternativeHeading, allPlanes, config, canvasWidth, canvasHeight);
    if (!prediction.willCollide) {
      return alternativeHeading;
    }
  }

  // No safe heading found - plane should hold position/slow down
  return null;
}

// Predict if a plane will enter the airport zone with its current/proposed heading
export interface AirportZonePrediction {
  willEnter: boolean;
  framesUntilEntry?: number;
  entryPoint?: { x: number; y: number };
}

export function predictAirportZoneEntry(
  plane: Plane,
  heading: number,
  airport: Airport,
  config: GameConfig,
  secondsAhead: number = 10
): AirportZonePrediction {
  const fps = 60;
  const totalFrames = secondsAhead * fps;
  const checkInterval = 5;

  const headingRad = (heading * Math.PI) / 180;
  const planeSpeed = plane.speed * config.gameSpeed;

  let simX = plane.position.x;
  let simY = plane.position.y;

  for (let frame = checkInterval; frame <= totalFrames; frame += checkInterval) {
    simX = plane.position.x + Math.cos(headingRad) * planeSpeed * frame;
    simY = plane.position.y + Math.sin(headingRad) * planeSpeed * frame;

    if (isOverAirport({ x: simX, y: simY }, airport.runwayStart, airport.runwayEnd, airport.runwayWidth)) {
      return {
        willEnter: true,
        framesUntilEntry: frame,
        entryPoint: { x: simX, y: simY },
      };
    }
  }

  return { willEnter: false };
}

// Find a heading that leads away from the airport zone
export function findHeadingAwayFromAirport(
  plane: Plane,
  airport: Airport,
  config: GameConfig
): number {
  const runwayCenter = {
    x: (airport.runwayStart.x + airport.runwayEnd.x) / 2,
    y: (airport.runwayStart.y + airport.runwayEnd.y) / 2,
  };

  // Calculate heading directly away from runway center
  const dx = plane.position.x - runwayCenter.x;
  const dy = plane.position.y - runwayCenter.y;
  const awayHeading = normalizeAngle((Math.atan2(dy, dx) * 180) / Math.PI);

  // Verify this heading doesn't lead into the airport zone
  const prediction = predictAirportZoneEntry(plane, awayHeading, airport, config, 5);
  if (!prediction.willEnter) {
    return awayHeading;
  }

  // If directly away still leads to airport (unlikely), try heading 180 (left)
  return 180;
}
