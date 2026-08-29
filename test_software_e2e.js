const { startServer, stopServer, PORT } = require('./server/src/index.js');
const autoDiscovery = require('./client/src/auto_discovery');
const captureEngine = require('./client/src/capture_engine');
const WebSocket = require('./server/node_modules/ws');
const http = require('http');

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function runSoftwareVerification() {
  console.log('=======================================================');
  console.log('🧪 Starting Full Software Integration & Discovery Tests');
  console.log('=======================================================');

  // Step 1: Start Server with UDP Discovery Beacon
  console.log('\n[Step 1] Launching WorkGuard Backend with Discovery Beacon...');
  await startServer(3000);
  console.log('✅ Server listening and broadcasting on UDP 38281');

  // Step 2: Test UDP Auto-Discovery from Client
  console.log('\n[Step 2] Testing Client UDP Auto-Discovery...');
  const discoveredPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Auto-Discovery timed out after 8s'));
    }, 8000);

    autoDiscovery.on('discovered', (info) => {
      clearTimeout(timeout);
      resolve(info);
    });
  });

  autoDiscovery.start();
  const serverInfo = await discoveredPromise;
  console.log(`✅ Client Auto-Discovery SUCCESS: Found server at ${serverInfo.httpUrl}`);
  autoDiscovery.stop();

  // Step 3: Test Hardware Capture Bypass Engine
  console.log('\n[Step 3] Testing Screen Grabber Hardware Bypass Engine...');
  const screenBuffer = await captureEngine.captureScreen(75);
  if (screenBuffer && screenBuffer.length > 5000) {
    console.log(`✅ Hardware Screen Capture SUCCESS! Image size: ${(screenBuffer.length / 1024).toFixed(1)} KB`);
  } else {
    throw new Error('Capture engine failed to produce valid image buffer');
  }

  // Step 4: Test WebSocket Registration & Live Stream
  console.log('\n[Step 4] Testing WebSocket Communication & Live Stream Relay...');
  const testClientId = 'test-station-01';

  // Simulate Agent WS
  const agentWs = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  await new Promise((resolve) => agentWs.on('open', resolve));
  agentWs.send(JSON.stringify({
    type: 'AGENT_REGISTER',
    client_id: testClientId,
    hostname: 'DESKTOP-TEST',
    username: 'QA_Tester',
    os: 'Windows 11 Test',
    current_app: 'electron.exe',
    current_window: 'WorkGuard Admin Test',
    cpu_usage: 12,
    ram_usage: 45
  }));

  // Simulate Admin WS
  const adminWs = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  await new Promise((resolve) => adminWs.on('open', resolve));
  adminWs.send(JSON.stringify({ type: 'ADMIN_REGISTER' }));

  let liveFramesReceived = 0;
  adminWs.on('message', (data, isBinary) => {
    if (isBinary) {
      liveFramesReceived++;
    }
  });

  // Admin subscribes to stream
  adminWs.send(JSON.stringify({
    type: 'START_VIEW_STREAM',
    target_client_id: testClientId
  }));

  // Wait 100ms then agent sends binary frame
  await new Promise(r => setTimeout(r, 200));
  agentWs.send(screenBuffer, { binary: true });
  await new Promise(r => setTimeout(r, 300));

  if (liveFramesReceived > 0) {
    console.log(`✅ Live Screen Streaming Relay SUCCESS! Received binary frame size: ${screenBuffer.length} bytes`);
  } else {
    throw new Error('Live frame not received by Admin WebSocket');
  }

  // Cleanup
  agentWs.close();
  adminWs.close();
  await stopServer();

  console.log('\n=======================================================');
  console.log('🎉 ALL SOFTWARE CAPABILITIES VERIFIED SUCCESSFULLY!');
  console.log('=======================================================');
}

runSoftwareVerification().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
