import { Plane, Position, Airport } from '../types/game';
import { randomInRange, distance } from './geometry';

// Minimum safe distance between planes at spawn (larger than collision distance of 30)
const MIN_SPAWN_DISTANCE = 120;
// Minimum distance from airport center when spawning
const MIN_AIRPORT_DISTANCE = 200;

const CALLSIGNS = [
  'AA', 'UA', 'DL', 'SW', 'BA', 'LH', 'AF', 'KL', 'QF', 'EK',
];

const COLORS = [
  '#60a5fa', // blue
  '#f472b6', // pink
  '#4ade80', // green
  '#fbbf24', // amber
  '#a78bfa', // purple
  '#f87171', // red
  '#2dd4bf', // teal
  '#fb923c', // orange
];

let planeCounter = 0;

export function generateCallsign(): string {
  const prefix = CALLSIGNS[Math.floor(Math.random() * CALLSIGNS.length)];
  const number = Math.floor(Math.random() * 900) + 100;
  return `${prefix}${number}`;
}

function generateSpawnPosition(
  canvasWidth: number,
  canvasHeight: number
): { position: Position; heading: number } {
  const margin = 50;

  // Only spawn from top, bottom, or left edges (exclude right - too close to airport)
  // All planes head horizontally RIGHT (0°) so they don't collide head-on
  const edge = Math.floor(Math.random() * 3); // 0 = top, 1 = bottom, 2 = left

  let position: Position;
  const heading = 0; // All planes head right toward the airport

  switch (edge) {
    case 0: // Top - spawn on left half to give room
      position = { x: randomInRange(margin, canvasWidth * 0.4), y: margin };
      break;
    case 1: // Bottom - spawn on left half to give room
      position = { x: randomInRange(margin, canvasWidth * 0.4), y: canvasHeight - margin };
      break;
    case 2: // Left
    default:
      position = { x: margin, y: randomInRange(margin, canvasHeight - margin) };
      break;
  }

  return { position, heading };
}

function isSafeSpawnPosition(
  position: Position,
  existingPlanes: Plane[],
  airport?: Airport
): boolean {
  // Check distance from all existing active planes
  for (const plane of existingPlanes) {
    if (plane.status === 'crashed' || plane.status === 'landed') continue;
    if (distance(position, plane.position) < MIN_SPAWN_DISTANCE) {
      return false;
    }
  }

  // Check distance from airport if provided
  if (airport && distance(position, airport.position) < MIN_AIRPORT_DISTANCE) {
    return false;
  }

  return true;
}

export function createPlane(
  canvasWidth: number,
  canvasHeight: number,
  existingPlanes: Plane[] = [],
  airport?: Airport
): Plane {
  planeCounter++;

  // Try to find a safe spawn position (max 10 attempts)
  let spawn = generateSpawnPosition(canvasWidth, canvasHeight);
  let attempts = 0;
  const maxAttempts = 10;

  while (!isSafeSpawnPosition(spawn.position, existingPlanes, airport) && attempts < maxAttempts) {
    spawn = generateSpawnPosition(canvasWidth, canvasHeight);
    attempts++;
  }

  return {
    id: `plane-${planeCounter}`,
    position: spawn.position,
    heading: spawn.heading,
    speed: randomInRange(0.3, 0.6),
    status: 'flying',
    callsign: generateCallsign(),
    color: COLORS[planeCounter % COLORS.length],
  };
}

export function resetPlaneCounter(): void {
  planeCounter = 0;
}
