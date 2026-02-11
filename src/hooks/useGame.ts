import { movePosition, checkCollision, isOnRunway, angleDifference, normalizeAngle, isInApproachZone, isOverAirport } from '../utils/geometry';
import { GameState, Plane, Airport, AICommand, GameConfig, ConversationMessage } from '../types/game';
import { createPlane, resetPlaneCounter } from '../utils/planeFactory';
import { useState, useCallback, useRef, useEffect } from 'react';
import { getAICommands } from '../services/openai';

const DEFAULT_CONFIG: GameConfig = {
  initialPlaneCount: 4,
  aiUpdateInterval: 5000,
  spawnInterval: 20000,
  minPlanes: 1,
  maxPlanes: 1,
  gameSpeed: 0.5,
  debugLogging: true, // Toggle debug logging for AI commands, crashes, landings
};

// Debug logging helper
function debugLog(config: GameConfig, category: string, message: string, data?: object) {
  if (!config.debugLogging) return;
  const timestamp = new Date().toISOString().slice(11, 23);
  const prefix = `[${timestamp}] [${category}]`;
  if (data) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

// Predictive collision detection - checks if a plane with a new heading would collide with other planes
interface CollisionPrediction {
  willCollide: boolean;
  collidingPlane?: Plane;
  timeToCollision?: number;
  collisionPoint?: { x: number; y: number };
}

function predictCollision(
  plane: Plane,
  newHeading: number,
  allPlanes: Plane[],
  config: GameConfig,
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

      // Calculate distance between simulated positions
      const dist = Math.sqrt(
        Math.pow(simX - otherSimX, 2) + Math.pow(simY - otherSimY, 2)
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
function findSafeHeading(
  plane: Plane,
  requestedHeading: number,
  allPlanes: Plane[],
  config: GameConfig
): number | null {
  // Try adjustments in both directions, starting small
  const adjustments = [30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180];

  for (const adjustment of adjustments) {
    const alternativeHeading = normalizeAngle(requestedHeading + adjustment);
    const prediction = predictCollision(plane, alternativeHeading, allPlanes, config);
    if (!prediction.willCollide) {
      return alternativeHeading;
    }
  }

  // No safe heading found - plane should hold position/slow down
  return null;
}

// Predict if a plane will enter the airport zone with its current/proposed heading
interface AirportZonePrediction {
  willEnter: boolean;
  framesUntilEntry?: number;
  entryPoint?: { x: number; y: number };
}

function predictAirportZoneEntry(
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
function findHeadingAwayFromAirport(
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

function createInitialAirport(canvasWidth: number, canvasHeight: number): Airport {
  const centerX = canvasWidth * 0.75; // Positioned to the right
  const centerY = canvasHeight / 2;
  const runwayLength = 200;

  return {
    position: { x: centerX, y: centerY },
    runwayStart: { x: centerX - runwayLength / 2, y: centerY },
    runwayEnd: { x: centerX + runwayLength / 2, y: centerY },
    runwayWidth: 40,
    runwayHeading: 0, // Planes should approach heading ~0 (from left to right) or ~180 (from right to left)
  };
}

export function useGame(canvasWidth: number, canvasHeight: number, apiKey: string) {
  const [gameState, setGameState] = useState<GameState>(() => ({
    planes: [],
    airport: createInitialAirport(canvasWidth, canvasHeight),
    canvasWidth,
    canvasHeight,
    isPaused: true,
    collisions: 0,
    landings: 0,
    gameTime: 0,
  }));

  const [aiLog, setAiLog] = useState<Array<{ time: string; message: string }>>([]);
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const lastAiCallRef = useRef<number>(0);
  const lastSpawnRef = useRef<number>(0);
  const configRef = useRef<GameConfig>(DEFAULT_CONFIG);
  // Conversation history for continuous AI context
  const conversationHistoryRef = useRef<ConversationMessage[]>([]);

  // Initialize game
  const initGame = useCallback(() => {
    resetPlaneCounter();
    const airport = createInitialAirport(canvasWidth, canvasHeight);
    const planes: Plane[] = [];

    // Spawn planes one at a time, passing existing planes to ensure safe distances
    for (let i = 0; i < configRef.current.initialPlaneCount; i++) {
      planes.push(createPlane(canvasWidth, canvasHeight, planes, airport));
    }

    setGameState({
      planes,
      airport,
      canvasWidth,
      canvasHeight,
      isPaused: true,
      collisions: 0,
      landings: 0,
      gameTime: 0,
    });
    setAiLog([]);
    lastAiCallRef.current = 0;
    lastSpawnRef.current = 0;
    conversationHistoryRef.current = []; // Reset conversation history
  }, [canvasWidth, canvasHeight]);

  // Update airport when canvas size changes
  useEffect(() => {
    setGameState(prev => ({
      ...prev,
      airport: createInitialAirport(canvasWidth, canvasHeight),
      canvasWidth,
      canvasHeight,
    }));
  }, [canvasWidth, canvasHeight]);

  // Apply AI command to a plane
  const applyCommand = useCallback((plane: Plane, command: AICommand, airport: Airport, allPlanes: Plane[]): Plane => {
    const updated = { ...plane };
    const config = configRef.current;

    // Calculate distance to runway center for logging
    const runwayCenter = {
      x: (airport.runwayStart.x + airport.runwayEnd.x) / 2,
      y: (airport.runwayStart.y + airport.runwayEnd.y) / 2,
    };
    const distToRunway = Math.round(Math.sqrt(
      Math.pow(plane.position.x - runwayCenter.x, 2) +
      Math.pow(plane.position.y - runwayCenter.y, 2)
    ));
    const inApproach = isInApproachZone(plane.position, airport.runwayStart, airport.runwayEnd, airport.runwayWidth);

    switch (command.action) {
      case 'turn':
        // Prevent AI from turning approaching planes - they auto-correct toward runway
        if (plane.status === 'approaching') {
          debugLog(config, 'AI-TURN-BLOCKED', `${plane.callsign} (${plane.id}) - turn blocked for approaching plane`, {
            requestedHeading: command.value,
            currentHeading: Math.round(plane.heading),
            status: plane.status,
          });
          break;
        }
        if (command.value !== undefined) {
          const oldHeading = plane.heading;
          let newHeading = normalizeAngle(command.value);

          // Predictive collision detection - check if this turn would cause a collision
          const prediction = predictCollision(plane, newHeading, allPlanes, config);
          if (prediction.willCollide && prediction.collidingPlane) {
            debugLog(config, 'AI-TURN-COLLISION-PREDICTED', `${plane.callsign} (${plane.id}) - turn would collide with ${prediction.collidingPlane.callsign}`, {
              requestedHeading: Math.round(newHeading),
              currentHeading: Math.round(oldHeading),
              collidingWith: prediction.collidingPlane.callsign,
              timeToCollision: prediction.timeToCollision?.toFixed(1) + 's',
              collisionPoint: prediction.collisionPoint,
            });

            // Try to find a safe alternative heading
            const safeHeading = findSafeHeading(plane, newHeading, allPlanes, config);
            if (safeHeading !== null) {
              debugLog(config, 'AI-TURN-REDIRECTED', `${plane.callsign} (${plane.id}) - redirecting to safe heading`, {
                originalHeading: Math.round(newHeading),
                safeHeading: Math.round(safeHeading),
              });
              newHeading = safeHeading;
            } else {
              // No safe heading found - reject the turn command entirely
              debugLog(config, 'AI-TURN-REJECTED', `${plane.callsign} (${plane.id}) - no safe heading found, maintaining current heading`, {
                requestedHeading: Math.round(newHeading),
                currentHeading: Math.round(oldHeading),
              });
              break;
            }
          }

          // Predictive airport zone detection - prevent flying planes from entering airport zone
          if (plane.status === 'flying') {
            const airportPrediction = predictAirportZoneEntry(plane, newHeading, airport, config, 6);
            if (airportPrediction.willEnter) {
              debugLog(config, 'AI-TURN-AIRPORT-PREDICTED', `${plane.callsign} (${plane.id}) - turn would enter airport zone`, {
                requestedHeading: Math.round(newHeading),
                currentHeading: Math.round(oldHeading),
                framesUntilEntry: airportPrediction.framesUntilEntry,
                entryPoint: airportPrediction.entryPoint,
              });

              // Try to find a heading away from the airport
              const safeHeading = findHeadingAwayFromAirport(plane, airport, config);
              // Verify the safe heading also doesn't cause a collision
              const collisionCheck = predictCollision(plane, safeHeading, allPlanes, config);
              if (!collisionCheck.willCollide) {
                debugLog(config, 'AI-TURN-REDIRECTED-AIRPORT', `${plane.callsign} (${plane.id}) - redirecting away from airport`, {
                  originalHeading: Math.round(newHeading),
                  safeHeading: Math.round(safeHeading),
                });
                newHeading = safeHeading;
              } else {
                // Can't turn toward airport and can't find safe heading - reject
                debugLog(config, 'AI-TURN-REJECTED-AIRPORT', `${plane.callsign} (${plane.id}) - no safe heading found, maintaining current heading`, {
                  requestedHeading: Math.round(newHeading),
                  currentHeading: Math.round(oldHeading),
                });
                break;
              }
            }
          }

          updated.heading = newHeading;

          // Calculate heading change magnitude
          let headingChange = Math.abs(newHeading - oldHeading);
          if (headingChange > 180) headingChange = 360 - headingChange;

          debugLog(config, 'AI-TURN', `${plane.callsign} (${plane.id})`, {
            oldHeading: Math.round(oldHeading),
            newHeading: Math.round(newHeading),
            headingChange: Math.round(headingChange),
            position: { x: Math.round(plane.position.x), y: Math.round(plane.position.y) },
            distanceToRunway: distToRunway,
            inApproachZone: inApproach,
            status: plane.status,
            speed: plane.speed.toFixed(2),
          });
        }
        break;
      case 'speed':
        if (command.value !== undefined) {
          const oldSpeed = plane.speed;
          updated.speed = Math.max(0.15, Math.min(0.8, command.value));
          debugLog(config, 'AI-SPEED', `${plane.callsign} (${plane.id})`, {
            oldSpeed: oldSpeed.toFixed(2),
            newSpeed: updated.speed.toFixed(2),
            distanceToRunway: distToRunway,
            status: plane.status,
          });
        }
        break;
      case 'approach':
        // Only allow approach if plane is in the approach zone
        if (inApproach) {
          updated.status = 'approaching';
          updated.speed = Math.min(updated.speed, 0.4);
          debugLog(config, 'AI-APPROACH', `${plane.callsign} (${plane.id}) entering approach`, {
            heading: Math.round(plane.heading),
            speed: updated.speed.toFixed(2),
            position: { x: Math.round(plane.position.x), y: Math.round(plane.position.y) },
            distanceToRunway: distToRunway,
          });
        } else {
          debugLog(config, 'AI-APPROACH-DENIED', `${plane.callsign} (${plane.id}) not in approach zone`, {
            heading: Math.round(plane.heading),
            position: { x: Math.round(plane.position.x), y: Math.round(plane.position.y) },
            distanceToRunway: distToRunway,
          });
        }
        break;
      case 'hold':
        // Prevent AI from putting approaching planes in hold pattern
        if (plane.status === 'approaching') {
          debugLog(config, 'AI-HOLD-BLOCKED', `${plane.callsign} (${plane.id}) - hold blocked for approaching plane`, {
            currentHeading: Math.round(plane.heading),
            status: plane.status,
          });
          break;
        }

        const oldHoldHeading = updated.heading;
        const oldHoldSpeed = updated.speed;

        // First, check if current heading would take plane into airport zone
        const airportPrediction = predictAirportZoneEntry(plane, plane.heading, airport, config, 6);

        if (airportPrediction.willEnter) {
          // URGENT: Plane is heading toward airport zone - immediately turn away
          const safeHeading = findHeadingAwayFromAirport(plane, airport, config);
          updated.heading = safeHeading;
          updated.speed = Math.max(0.15, updated.speed * 0.7); // Slow down more aggressively

          debugLog(config, 'AI-HOLD-EMERGENCY', `${plane.callsign} (${plane.id}) emergency turn - heading toward airport zone`, {
            oldHeading: Math.round(oldHoldHeading),
            newHeading: Math.round(updated.heading),
            framesUntilAirportEntry: airportPrediction.framesUntilEntry,
            oldSpeed: oldHoldSpeed.toFixed(2),
            newSpeed: updated.speed.toFixed(2),
            distanceToRunway: distToRunway,
          });
        } else {
          // Normal hold pattern - gradually turn toward 180° (left, away from runway)
          const targetHoldHeading = 180;
          const currentHeading = updated.heading;
          const diff = targetHoldHeading - currentHeading;

          // Gradually turn toward 180° (15° per update)
          if (Math.abs(diff) > 15) {
            updated.heading = normalizeAngle(currentHeading + (diff > 0 ? 15 : -15));
          } else {
            updated.heading = targetHoldHeading;
          }
          updated.speed = Math.max(0.2, updated.speed * 0.8);

          debugLog(config, 'AI-HOLD', `${plane.callsign} (${plane.id}) holding pattern`, {
            oldHeading: Math.round(oldHoldHeading),
            newHeading: Math.round(updated.heading),
            oldSpeed: oldHoldSpeed.toFixed(2),
            newSpeed: updated.speed.toFixed(2),
            distanceToRunway: distToRunway,
            status: plane.status,
          });
        }
        break;
    }

    return updated;
  }, []);

  // Check if plane can land
  const checkLanding = useCallback((plane: Plane, airport: Airport): Plane => {
    if (plane.status === 'landed' || plane.status === 'crashed') {
      return plane;
    }

    // Use extended landing zone (includeLandingExtension=true) so planes that overshoot
    // the runway slightly can still complete their landing
    const onRunway = isOnRunway(
      plane.position,
      airport.runwayStart,
      airport.runwayEnd,
      airport.runwayWidth,
      true // Include landing extension zone past runway end
    );

    if (onRunway && plane.status === 'approaching') {
      // Check if heading is aligned with runway - MUST approach from left (heading ~0°)
      // Planes must follow the green approach lights and land heading right
      const headingDiff = Math.abs(angleDifference(plane.heading, airport.runwayHeading));

      if (headingDiff < 25 && plane.speed < 2) {
        debugLog(configRef.current, 'LANDING', `${plane.callsign} landed successfully`, {
          id: plane.id,
          callsign: plane.callsign,
          finalPosition: { x: Math.round(plane.position.x), y: Math.round(plane.position.y) },
          finalHeading: Math.round(plane.heading),
          finalSpeed: plane.speed.toFixed(2),
          headingDiff: Math.round(headingDiff),
        });
        return { ...plane, status: 'landed', speed: 0 };
      }
    }

    return plane;
  }, []);

  // Main game update
  const updateGame = useCallback((deltaTime: number) => {
    setGameState(prev => {
      if (prev.isPaused) return prev;

      const dt = deltaTime / 16.67; // Normalize to ~60fps
      let newPlanes = [...prev.planes];
      let newCollisions = prev.collisions;

      // Update plane positions
      newPlanes = newPlanes.map(plane => {
        if (plane.status === 'landed' || plane.status === 'crashed') {
          return plane;
        }

        let updatedPlane = { ...plane };

        // Auto-correct heading for approaching planes to intercept runway centerline
        if (updatedPlane.status === 'approaching') {
          const runwayCenter = {
            x: (prev.airport.runwayStart.x + prev.airport.runwayEnd.x) / 2,
            y: (prev.airport.runwayStart.y + prev.airport.runwayEnd.y) / 2,
          };

          // Calculate heading needed to reach runway center
          const dx = runwayCenter.x - updatedPlane.position.x;
          const dy = runwayCenter.y - updatedPlane.position.y;
          const targetHeading = normalizeAngle((Math.atan2(dy, dx) * 180) / Math.PI);

          // Gradually adjust heading toward target (max 2° per frame for smooth correction)
          const headingDiff = angleDifference(updatedPlane.heading, targetHeading);
          if (Math.abs(headingDiff) > 1) {
            const correction = Math.sign(headingDiff) * Math.min(Math.abs(headingDiff), 2);
            updatedPlane.heading = normalizeAngle(updatedPlane.heading + correction);
          }
        }

        // Move plane (gameSpeed scales movement without affecting AI speed commands)
        const newPosition = movePosition(updatedPlane.position, updatedPlane.heading, updatedPlane.speed * dt * configRef.current.gameSpeed);

        // Keep in bounds (wrap around)
        if (newPosition.x < -50) newPosition.x = prev.canvasWidth + 50;
        if (newPosition.x > prev.canvasWidth + 50) newPosition.x = -50;
        if (newPosition.y < -50) newPosition.y = prev.canvasHeight + 50;
        if (newPosition.y > prev.canvasHeight + 50) newPosition.y = -50;

        return { ...updatedPlane, position: newPosition };
      });

      // Check for collisions
      for (let i = 0; i < newPlanes.length; i++) {
        for (let j = i + 1; j < newPlanes.length; j++) {
          if (checkCollision(newPlanes[i], newPlanes[j])) {
            if (newPlanes[i].status !== 'crashed' && newPlanes[j].status !== 'crashed') {
              debugLog(configRef.current, 'CRASH-COLLISION', `${newPlanes[i].callsign} collided with ${newPlanes[j].callsign}`, {
                plane1: {
                  id: newPlanes[i].id,
                  callsign: newPlanes[i].callsign,
                  position: { x: Math.round(newPlanes[i].position.x), y: Math.round(newPlanes[i].position.y) },
                  heading: Math.round(newPlanes[i].heading),
                  speed: newPlanes[i].speed.toFixed(2),
                  status: newPlanes[i].status,
                },
                plane2: {
                  id: newPlanes[j].id,
                  callsign: newPlanes[j].callsign,
                  position: { x: Math.round(newPlanes[j].position.x), y: Math.round(newPlanes[j].position.y) },
                  heading: Math.round(newPlanes[j].heading),
                  speed: newPlanes[j].speed.toFixed(2),
                  status: newPlanes[j].status,
                },
                gameTime: prev.gameTime.toFixed(1),
              });
              newPlanes[i] = { ...newPlanes[i], status: 'crashed' };
              newPlanes[j] = { ...newPlanes[j], status: 'crashed' };
              newCollisions++;
            }
          }
        }
      }

      // Check for planes flying over airport (only approaching planes are allowed)
      newPlanes = newPlanes.map(plane => {
        if (plane.status === 'flying') {
          const overAirport = isOverAirport(
            plane.position,
            prev.airport.runwayStart,
            prev.airport.runwayEnd,
            prev.airport.runwayWidth
          );
          if (overAirport) {
            debugLog(configRef.current, 'CRASH-AIRPORT', `${plane.callsign} crashed - flew over airport without approach status`, {
              id: plane.id,
              callsign: plane.callsign,
              position: { x: Math.round(plane.position.x), y: Math.round(plane.position.y) },
              heading: Math.round(plane.heading),
              speed: plane.speed.toFixed(2),
              status: plane.status,
              gameTime: prev.gameTime.toFixed(1),
            });
            newCollisions++;
            return { ...plane, status: 'crashed' };
          }
        }
        return plane;
      });

      // Check for landings
      newPlanes = newPlanes.map(plane => checkLanding(plane, prev.airport));

      // Count new landings before removing landed planes
      const newLandings = newPlanes.filter(p => p.status === 'landed').length;

      // Remove landed planes from the game
      newPlanes = newPlanes.filter(p => p.status !== 'landed');

      return {
        ...prev,
        planes: newPlanes,
        collisions: newCollisions,
        landings: prev.landings + newLandings,
        gameTime: prev.gameTime + deltaTime / 1000,
      };
    });
  }, [checkLanding]);

  // AI control loop - single agent controls all planes
  const callAI = useCallback(async () => {
    if (!apiKey || isAiProcessing) return;

    const activePlanes = gameState.planes.filter(p => p.status !== 'landed' && p.status !== 'crashed');
    if (activePlanes.length === 0) return;

    setIsAiProcessing(true);
    const timestamp = new Date().toLocaleTimeString();

    try {
      const { response, newMessages } = await getAICommands(
        apiKey,
        gameState.planes,
        gameState.airport,
        canvasWidth,
        canvasHeight,
        conversationHistoryRef.current
      );

      // Store only the previous exchange for context
      conversationHistoryRef.current = newMessages;

      // Update AI log
      setAiLog(prev => [
        { time: timestamp, message: response.reasoning || 'No reasoning provided' },
        ...prev.slice(0, 9),
      ]);

      // Apply all commands
      if (response.commands.length > 0) {
        debugLog(configRef.current, 'AI-RESPONSE', `Received ${response.commands.length} command(s)`, {
          reasoning: response.reasoning,
          commands: response.commands,
        });

        setGameState(prev => {
          const updatedPlanes = prev.planes.map(plane => {
            const planeCommand = response.commands.find(c => c.planeId === plane.id);
            if (planeCommand) {
              return applyCommand(plane, planeCommand, prev.airport, prev.planes);
            }
            return plane;
          });
          return { ...prev, planes: updatedPlanes };
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setAiLog(prev => [
        { time: timestamp, message: `Error: ${errorMessage}` },
        ...prev.slice(0, 9),
      ]);
    } finally {
      setIsAiProcessing(false);
    }
  }, [apiKey, gameState.planes, gameState.airport, canvasWidth, canvasHeight, applyCommand, isAiProcessing]);

  // Periodic AI calls and plane spawning
  useEffect(() => {
    if (gameState.isPaused) return;

    const now = Date.now();

    // AI call at configured interval
    if (now - lastAiCallRef.current >= configRef.current.aiUpdateInterval) {
      lastAiCallRef.current = now;
      callAI();
    }

    // Count active planes (not crashed)
    const activeCount = gameState.planes.filter(
      p => p.status !== 'crashed'
    ).length;

    // Spawn immediately if below minimum
    if (activeCount < configRef.current.minPlanes) {
      setGameState(prev => ({
        ...prev,
        planes: [
          ...prev.planes,
          createPlane(canvasWidth, canvasHeight, prev.planes, prev.airport),
        ],
      }));
    }
    // Spawn periodically if below maximum
    else if (now - lastSpawnRef.current >= configRef.current.spawnInterval) {
      if (activeCount < configRef.current.maxPlanes) {
        lastSpawnRef.current = now;
        setGameState(prev => ({
          ...prev,
          planes: [
            ...prev.planes,
            createPlane(canvasWidth, canvasHeight, prev.planes, prev.airport),
          ],
        }));
      }
    }
  }, [gameState.isPaused, gameState.planes, canvasWidth, canvasHeight, callAI]);

  // Toggle pause
  const togglePause = useCallback(() => {
    setGameState(prev => ({ ...prev, isPaused: !prev.isPaused }));
    if (gameState.isPaused) {
      lastAiCallRef.current = Date.now();
      lastSpawnRef.current = Date.now();
    }
  }, [gameState.isPaused]);

  // Force AI call
  const forceAiCall = useCallback(() => {
    callAI();
  }, [callAI]);

  return {
    gameState,
    aiLog,
    isAiProcessing,
    initGame,
    updateGame,
    togglePause,
    forceAiCall,
  };
}
