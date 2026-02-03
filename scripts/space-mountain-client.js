const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SWITCHBOARD_URL = process.env.SPACE_MOUNTAIN_SWITCHBOARD || 'ws://localhost:6068';
const APP_NAME = process.env.SPACE_MOUNTAIN_APP || 'cosmic-raid';
const APP_PORT = Number(process.env.PORT || 3001);
const APP_ROLE = process.env.SPACE_MOUNTAIN_ROLE || 'primary';

function isWithinSpaceMountain() {
  const currentDir = process.cwd();
  let checkDir = currentDir;
  
  for (let i = 0; i < 5; i++) {
    const parentDir = path.dirname(checkDir);
    if (parentDir === checkDir) break;
    
    const launcherFiles = [
      path.join(parentDir, 'Space Mountain Launcher', 'main.js'),
      path.join(parentDir, 'main.js'),
      path.join(parentDir, 'simple-launcher.js')
    ];
    
    if (launcherFiles.some(file => fs.existsSync(file))) {
      return true;
    }
    
    checkDir = parentDir;
  }
  
  return false;
}

if (!isWithinSpaceMountain()) {
  console.log('[Space Mountain] Running in standalone mode - Space Mountain client disabled');
  process.exit(0);
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let currentWs = null;
let isRegistered = false;

const probeApp = () => new Promise((resolve, reject) => {
  const req = http.get({
    host: '127.0.0.1',
    port: APP_PORT,
    path: '/',
    timeout: 3000
  }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode && res.statusCode < 500));
  });
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', reject);
});

const waitForAppReady = async () => {
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      const ok = await probeApp();
      if (ok) {
        console.log(`[Space Mountain] ${APP_NAME} HTTP ready on port ${APP_PORT}`);
        return;
      }
    } catch {}
    console.log(`[Space Mountain] Waiting for ${APP_NAME} (${attempt}/15)...`);
    await wait(2000);
  }
  console.warn(`[Space Mountain] ${APP_NAME} proceeding without readiness confirmation`);
};

function register(ws) {
  if (isRegistered) return;
  
  try {
    ws.send(JSON.stringify({
      type: 'REGISTER_APP',
      payload: { appName: APP_NAME, appPort: APP_PORT, role: APP_ROLE }
    }));
    
    ws.send(JSON.stringify({
      type: 'ROUTE_MESSAGE',
      targetApp: 'apollo-station',
      payload: {
        type: 'app-register',
        payload: { name: APP_NAME, port: APP_PORT, status: 'running' }
      }
    }));
    
    isRegistered = true;
    console.log(`[Space Mountain] ${APP_NAME} registration complete`);
  } catch (error) {
    console.error(`[Space Mountain] Failed to register ${APP_NAME}:`, error);
  }
}

function connect() {
  if (currentWs && currentWs.readyState === WebSocket.OPEN) return;
  
  const ws = new WebSocket(SWITCHBOARD_URL);
  currentWs = ws;

  ws.on('open', async () => {
    console.log(`[Space Mountain] Docking ${APP_NAME} on port ${APP_PORT}`);
    await waitForAppReady();
    register(ws);
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log(`[Space Mountain] ${APP_NAME} received:`, message.type);
    } catch (error) {
      console.error(`[Space Mountain] ${APP_NAME} message error:`, error);
    }
  });

  ws.on('close', () => {
    isRegistered = false;
    currentWs = null;
    console.log(`[Space Mountain] ${APP_NAME} link closed. Retrying in 5s...`);
    setTimeout(connect, 5000);
  });

  ws.on('error', (error) => {
    console.error(`[Space Mountain] ${APP_NAME} link error:`, error.message);
  });
}

const shutdown = async () => {
  console.log(`[Space Mountain] ${APP_NAME} undocking...`);
  if (currentWs) currentWs.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGBREAK', shutdown);

connect();