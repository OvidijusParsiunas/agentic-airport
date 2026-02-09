import { movePosition, checkCollision, isOnRunway, angleDifference, normalizeAngle, isInApproachZone, isOverAirport } from '../utils/geometry';
import { GameState, Plane, Airport, AICommand, GameConfig, SharedContext, PlaneDecision } from '../types/game';
import { createPlane, resetPlaneCounter } from '../utils/planeFactory';
import { useState, useCallback, useRef, useEffect } from 'react';
import { getPlaneAgentCommand, buildLandingQueue, buildCoordinationNote } from '../services/openai';

const DEFAULT_CONFIG: GameConfig = {
  initialPlaneCount: 1,
  aiUpdateInterval: 5000, // 5 seconds
  spawnInterval: 15000, // 15 seconds
  minPlanes: 3, // Minimum active planes (new ones spawn when below this)
  maxPlanes: 3, // Maximum active planes
  gameSpeed: 0.5, // Multiplier for plane movement speed (1.0 = normal, 0.5 = half speed)
};

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
  // Shared context for multi-agent coordination
  const sharedContextRef = useRef<SharedContext>({
    recentDecisions: [],
    landingQueue: [],
    lastUpdateTime: 0,
    coordinationNote: '',
  });

  // Initialize game
  const initGame = useCallback(() => {
    resetPlaneCounter();
    const airport = createInitialAirport(canvasWidth, canvasHeight);
    const planes: Plane[] = [];

      // planes.push(createPlane(canvasWidth, canvasHeight));

    for (let i = 0; i < configRef.current.initialPlaneCount; i++) {
      planes.push(createPlane(canvasWidth, canvasHeight));
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
  const applyCommand = useCallback((plane: Plane, command: AICommand, airport: Airport): Plane => {
    const updated = { ...plane };

    switch (command.action) {
      case 'turn':
        if (command.value !== undefined) {
          updated.heading = normalizeAngle(command.value);
        }
        break;
      case 'speed':
        if (command.value !== undefined) {
          updated.speed = Math.max(0.15, Math.min(0.8, command.value));
        }
        break;
      case 'approach':
        // Only allow approach if plane is in the approach zone
        if (isInApproachZone(plane.position, airport.runwayStart, airport.runwayEnd, airport.runwayWidth)) {
          updated.status = 'approaching';
          updated.speed = Math.min(updated.speed, 0.4);
        }
        break;
      case 'hold':
        // Plane will turn away from runway and slow down significantly
        // Runway is on the right (x ≈ 600), so turn toward heading 180° (left)
        const targetHoldHeading = 180; // Fly left, away from runway
        const currentHeading = updated.heading;
        const diff = targetHoldHeading - currentHeading;
        // Gradually turn toward 180° (15° per update)
        if (Math.abs(diff) > 15) {
          updated.heading = normalizeAngle(currentHeading + (diff > 0 ? 15 : -15));
        } else {
          updated.heading = targetHoldHeading;
        }
        updated.speed = Math.max(0.2, updated.speed * 0.8); // Slow down more aggressively
        break;
    }

    return updated;
  }, []);

  // Check if plane can land
  const checkLanding = useCallback((plane: Plane, airport: Airport): Plane => {
    if (plane.status === 'landed' || plane.status === 'crashed') {
      return plane;
    }

    const onRunway = isOnRunway(
      plane.position,
      airport.runwayStart,
      airport.runwayEnd,
      airport.runwayWidth
    );

    if (onRunway && plane.status === 'approaching') {
      // Check if heading is aligned with runway - MUST approach from left (heading ~0°)
      // Planes must follow the green approach lights and land heading right
      const headingDiff = Math.abs(angleDifference(plane.heading, airport.runwayHeading));

      if (headingDiff < 25 && plane.speed < 2) {
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

        // Move plane (gameSpeed scales movement without affecting AI speed commands)
        const newPosition = movePosition(plane.position, plane.heading, plane.speed * dt * configRef.current.gameSpeed);

        // Keep in bounds (wrap around)
        if (newPosition.x < -50) newPosition.x = prev.canvasWidth + 50;
        if (newPosition.x > prev.canvasWidth + 50) newPosition.x = -50;
        if (newPosition.y < -50) newPosition.y = prev.canvasHeight + 50;
        if (newPosition.y > prev.canvasHeight + 50) newPosition.y = -50;

        return { ...plane, position: newPosition };
      });

      // Check for collisions
      for (let i = 0; i < newPlanes.length; i++) {
        for (let j = i + 1; j < newPlanes.length; j++) {
          if (checkCollision(newPlanes[i], newPlanes[j])) {
            if (newPlanes[i].status !== 'crashed' && newPlanes[j].status !== 'crashed') {
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

  // AI control loop - calls one agent per plane in parallel with shared context
  const callAI = useCallback(async () => {
    if (!apiKey || isAiProcessing) return;

    const activePlanes = gameState.planes.filter(p => p.status !== 'landed' && p.status !== 'crashed');
    if (activePlanes.length === 0) return;

    setIsAiProcessing(true);
    const timestamp = new Date().toLocaleTimeString();

    try {
      // Build shared context for this round
      const landingQueue = buildLandingQueue(gameState.planes, gameState.airport);
      const coordinationNote = buildCoordinationNote(landingQueue);

      const currentSharedContext: SharedContext = {
        recentDecisions: sharedContextRef.current.recentDecisions,
        landingQueue,
        lastUpdateTime: Date.now(),
        coordinationNote,
      };

      // Call AI agent for each plane in parallel, passing shared context
      const agentPromises = activePlanes.map(plane =>
        getPlaneAgentCommand(
          apiKey,
          plane,
          gameState.planes,
          gameState.airport,
          canvasWidth,
          canvasHeight,
          currentSharedContext
        ).then(response => ({ plane, response }))
         .catch(error => ({ plane, error: error instanceof Error ? error.message : 'Unknown error' }))
      );

      const results = await Promise.all(agentPromises);

      // Collect log messages, commands, and new decisions for shared context
      const logMessages: string[] = [];
      const commands: AICommand[] = [];
      const newDecisions: PlaneDecision[] = [];

      // Get navigation data for distance info
      for (const result of results) {
        if ('error' in result) {
          logMessages.push(`[${result.plane.callsign}]: Error - ${result.error}`);
        } else {
          const { plane, response } = result;
          const queueEntry = landingQueue.find(e => e.planeId === plane.id);
          const priority = queueEntry?.priority ?? '?';
          logMessages.push(`[${plane.callsign} P${priority}]: ${response.reasoning || 'No reasoning'}`);

          // Store this decision for next round's shared context
          newDecisions.push({
            planeId: plane.id,
            callsign: plane.callsign,
            action: response.command?.action || 'none',
            value: response.command?.value,
            reasoning: response.reasoning || '',
            timestamp: Date.now(),
            distanceToRunway: queueEntry?.distanceToRunway ?? 0,
            status: plane.status,
          });

          if (response.command) {
            commands.push(response.command);
          }
        }
      }

      // Update shared context with this round's decisions
      sharedContextRef.current = {
        ...currentSharedContext,
        recentDecisions: newDecisions,
      };

      // Update AI log with all agent responses
      setAiLog(prev => [
        { time: timestamp, message: logMessages.join('\n') },
        ...prev.slice(0, 9),
      ]);

      // Apply all commands
      if (commands.length > 0) {
        setGameState(prev => {
          const updatedPlanes = prev.planes.map(plane => {
            const planeCommand = commands.find(c => c.planeId === plane.id);
            if (planeCommand) {
              return applyCommand(plane, planeCommand, prev.airport);
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

    // AI call every 10 seconds
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
          createPlane(canvasWidth, canvasHeight),
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
            createPlane(canvasWidth, canvasHeight),
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
