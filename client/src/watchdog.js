const { spawn } = require('child_process');
const path = require('path');

/**
 * WorkGuard Endpoint Anti-Kill Watchdog Supervisor
 * Monitors the background agent daemon process.
 * If an employee attempts to terminate node.exe via Task Manager or console,
 * the watchdog immediately restarts the agent seamlessly within 2 seconds.
 */

const AGENT_SCRIPT = path.join(__dirname, 'agent.js');
let agentProcess = null;
let isIntentionalQuit = false;

function spawnAgent() {
  if (isIntentionalQuit) return;

  console.log(`[Watchdog] 🛡️ Spawning WorkGuard Agent Supervisor: ${AGENT_SCRIPT}`);

  agentProcess = spawn(process.execPath, [AGENT_SCRIPT, ...process.argv.slice(2)], {
    stdio: 'inherit',
    windowsHide: true,
    env: process.env
  });

  agentProcess.on('exit', (code, signal) => {
    console.warn(`[Watchdog] ⚠️ WorkGuard Agent stopped (code: ${code}, signal: ${signal}).`);
    agentProcess = null;

    if (!isIntentionalQuit) {
      console.log('[Watchdog] 🔄 Self-healing anti-tamper trigger: Restarting agent in 2.5s...');
      setTimeout(() => {
        spawnAgent();
      }, 2500);
    }
  });

  agentProcess.on('error', (err) => {
    console.error('[Watchdog] Agent process error:', err.message);
  });
}

process.on('SIGINT', () => {
  isIntentionalQuit = true;
  if (agentProcess) agentProcess.kill('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  isIntentionalQuit = true;
  if (agentProcess) agentProcess.kill('SIGTERM');
  process.exit(0);
});

// Start supervision
spawnAgent();
