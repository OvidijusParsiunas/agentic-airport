import { movePosition, checkCollision, isOnRunway, angleDifference, normalizeAngle, isOverAirport } from '../utils/geometry';
import { GameState, Plane, Airport, GameConfig, ConversationMessage } from '../types/game';
import { createPlane, resetPlaneCounter } from '../utils/planeFactory';
import { useState, useCallback, useRef, useEffect } from 'react';
import { getAICommands } from '../services/openai';
import { debugLog } from '../utils/debug';
import { applyCommand } from '../utils/commandHandler';

const DEFAULT_CONFIG: GameConfig = {
  initialPlaneCount: 4,
  aiUpdateInterval: 5000,
  spawnInterval: 20000,
  minPlanes: 1,
  maxPlanes: 1,
  gameSpeed: 0.5,
  debugLogging: true, // Toggle debug logging for AI commands, crashes, landings
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
              return applyCommand(plane, planeCommand, prev.airport, prev.planes, configRef.current);
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
  }, [apiKey, gameState.planes, gameState.airport, canvasWidth, canvasHeight, isAiProcessing]);

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
