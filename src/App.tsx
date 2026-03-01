import React, { useState, useCallback, useEffect } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { useGame } from './hooks/useGame';
import { useGameLoop } from './hooks/useGameLoop';

function App() {
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('openai_api_key') || '');

  const {
    gameState,
    aiLog,
    isAiProcessing,
    config,
    initGame,
    updateGame,
    togglePause,
    updateConfig,
  } = useGame(canvasSize.width, canvasSize.height, apiKey);

  const [settingsOpen, setSettingsOpen] = useState(false);

  // Initialize game on mount
  useEffect(() => {
    initGame();
  }, [initGame]);

  // Run game loop
  useGameLoop(updateGame, !gameState.isPaused);

  // Handle canvas resize
  const handleResize = useCallback((width: number, height: number) => {
    setCanvasSize({ width, height });
  }, []);

  // Save API key
  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const key = e.target.value;
    setApiKey(key);
    localStorage.setItem('openai_api_key', key);
  };

  const activePlanes = gameState.planes.filter(
    p => p.status !== 'landed' && p.status !== 'crashed'
  );

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>AGENTIC AIRPORT</h1>
        <div className="stats">
          <div className="stat">
            <span className="stat-value">{formatTime(gameState.gameTime)}</span>
            <span className="stat-label">Time</span>
          </div>
          <div className="stat">
            <span className="stat-value">{activePlanes.length}</span>
            <span className="stat-label">Active</span>
          </div>
          <div className="stat">
            <span className="stat-value success">{gameState.landings}</span>
            <span className="stat-label">Landings</span>
          </div>
          <div className="stat">
            <span className="stat-value danger">{gameState.collisions}</span>
            <span className="stat-label">Collisions</span>
          </div>
        </div>
      </header>

      <div className="main-content">
        <GameCanvas gameState={gameState} onResize={handleResize} />

        <aside className="sidebar">
          <div className="sidebar-section">
            <h3>
              OpenAI API Key
              <span className="info-icon-wrapper">
                <svg
                  className="info-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span className="info-tooltip">
                  Your API key is not stored on any server. It communicates directly from your computer to OpenAI.
                </span>
              </span>
            </h3>
            <input
              type="password"
              className="api-key-input"
              placeholder="sk-..."
              value={apiKey}
              onChange={handleApiKeyChange}
            />
            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
              <span
                className={`status-indicator ${apiKey.startsWith('sk-') ? 'connected' : 'disconnected'}`}
              />
              {apiKey.startsWith('sk-') ? 'API key set' : 'Enter your API key'}
            </div>
          </div>

          <div className="sidebar-section">
            <h3>
              Controls
              <button
                className="settings-toggle"
                onClick={() => setSettingsOpen(!settingsOpen)}
                title="Game Settings"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={settingsOpen ? 'settings-icon-active' : ''}
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            </h3>
            <div className="controls">
              <button className="btn btn-primary" onClick={togglePause}>
                {gameState.isPaused ? 'Start' : 'Pause'}
              </button>
              <button className="btn btn-secondary" onClick={initGame}>
                Reset
              </button>
              {isAiProcessing && (
                <div className="ai-status">Thinking...</div>
              )}
            </div>
          </div>

          <div className={`settings-panel ${settingsOpen ? 'open' : ''}`}>
            <div className="settings-content">
              <div className="setting-item">
                <label>Initial Planes</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={config.initialPlaneCount}
                  onChange={e => updateConfig({ initialPlaneCount: parseInt(e.target.value) || 1 })}
                />
              </div>
              <div className="setting-item">
                <label>Min Planes</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={config.minPlanes}
                  onChange={e => updateConfig({ minPlanes: parseInt(e.target.value) || 1 })}
                />
              </div>
              <div className="setting-item">
                <label>Max Planes</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={config.maxPlanes}
                  onChange={e => updateConfig({ maxPlanes: parseInt(e.target.value) || 1 })}
                />
              </div>
              <div className="setting-item">
                <label>AI Interval (ms)</label>
                <input
                  type="number"
                  min="1000"
                  max="30000"
                  step="1000"
                  value={config.aiUpdateInterval}
                  onChange={e => updateConfig({ aiUpdateInterval: parseInt(e.target.value) || 5000 })}
                />
              </div>
              <div className="setting-item">
                <label>Spawn Interval (ms)</label>
                <input
                  type="number"
                  min="5000"
                  max="60000"
                  step="1000"
                  value={config.spawnInterval}
                  onChange={e => updateConfig({ spawnInterval: parseInt(e.target.value) || 20000 })}
                />
              </div>
              <div className="setting-item">
                <label>Game Speed</label>
                <div className="range-input">
                  <input
                    type="range"
                    min="0.1"
                    max="2"
                    step="0.1"
                    value={config.gameSpeed}
                    onChange={e => updateConfig({ gameSpeed: parseFloat(e.target.value) })}
                  />
                  <span>{config.gameSpeed.toFixed(1)}x</span>
                </div>
              </div>
              <div className="setting-item">
                <label>Debug Logging</label>
                <button
                  className={`toggle-btn ${config.debugLogging ? 'active' : ''}`}
                  onClick={() => updateConfig({ debugLogging: !config.debugLogging })}
                >
                  {config.debugLogging ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
          </div>

          <div className="sidebar-section">
            <h3>Active Planes</h3>
            <div className="plane-list">
            {gameState.planes.map(plane => (
              <div key={plane.id} className={`plane-item ${plane.status}`}>
                <div className="plane-callsign" style={{ color: plane.color }}>
                  {plane.callsign}
                </div>
                <div className="plane-info">
                  <span>HDG: {Math.round(plane.heading)}°</span>
                  <span>SPD: {plane.speed.toFixed(1)}</span>
                  <span>{plane.status.toUpperCase()}</span>
                </div>
              </div>
            ))}
            </div>
          </div>

          <div className="sidebar-section">
            <h3>AI Log</h3>
            <div className="ai-log">
            {aiLog.length === 0 ? (
              <div className="ai-log-entry">
                AI will analyze the situation every 10 seconds...
              </div>
            ) : (
              aiLog.map((entry, i) => (
                <div key={i} className="ai-log-entry">
                  <span className="timestamp">[{entry.time}]</span>
                  {entry.message}
                </div>
              ))
            )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default App;
