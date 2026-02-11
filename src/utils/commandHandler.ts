import { Plane, Airport, AICommand, GameConfig } from '../types/game';
import { normalizeAngle, isInApproachZone } from './geometry';
import { debugLog } from './debug';
import {
  predictCollision,
  findSafeHeading,
  predictAirportZoneEntry,
  findHeadingAwayFromAirport,
} from './flightPrediction';

// Apply AI command to a plane
export function applyCommand(
  plane: Plane,
  command: AICommand,
  airport: Airport,
  allPlanes: Plane[],
  config: GameConfig
): Plane {
  const updated = { ...plane };

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
}
