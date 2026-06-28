import { app, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse --config parameter
let configPath = '/etc/weather-forecast/api.conf';
for (let i = 0; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--config' && process.argv[i + 1]) {
    configPath = process.argv[i + 1];
    break;
  } else if (arg.startsWith('--config=')) {
    configPath = arg.substring('--config='.length);
    break;
  }
}

// Load configuration
let loaded = false;
try {
  if (fs.existsSync(configPath)) {
    console.log(`Loading config from: ${configPath}`);
    process.loadEnvFile(configPath);
    loaded = true;
  } else {
    console.warn(`Config file not found at: ${configPath}`);
  }
} catch (e) {
  console.error(`Failed to load config from ${configPath}:`, e);
}

// Fallback to local .env if no config was loaded
if (!loaded) {
  try {
    const localEnvPath = path.resolve(__dirname, '../.env');
    if (fs.existsSync(localEnvPath)) {
      console.log(`Falling back to local env file: ${localEnvPath}`);
      process.loadEnvFile(localEnvPath);
    } else {
      console.warn(`No local env file found at: ${localEnvPath}`);
    }
  } catch (e) {
    console.warn('Failed to load fallback local env file:', e);
  }
}

const isDev = process.env.NODE_ENV === 'development';
let devServerProcess = null;
let mainWindow = null;

// Helper to check/wait for a port to be open
function waitForPort(port, host = '127.0.0.1', timeout = 15000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    function check() {
      const socket = new net.Socket();
      socket.setTimeout(200);
      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - startTime > timeout) {
          reject(new Error(`Timeout waiting for port ${port}`));
        } else {
          setTimeout(check, 100);
        }
      });
      socket.connect(port, host);
    }
    check();
  });
}

// Helper to find a free port
function findFreePort(startPort) {
  return new Promise((resolve) => {
    function testPort(port) {
      const server = net.createServer();
      server.unref();
      server.on('error', () => {
        testPort(port + 1);
      });
      server.listen(port, '127.0.0.1', () => {
        server.close(() => {
          resolve(port);
        });
      });
    }
    testPort(startPort);
  });
}

async function startServer() {
  if (isDev) {
    console.log('Starting Astro dev server...');
    devServerProcess = spawn('node', [
      'node_modules/astro/bin/astro.mjs',
      'dev',
      '--port',
      '4321'
    ], {
      stdio: 'inherit',
      shell: true,
      cwd: path.resolve(__dirname, '..'),
      env: process.env
    });

    devServerProcess.on('close', (code) => {
      console.log(`Dev server exited with code ${code}`);
    });

    // Wait for the dev server to start listening
    await waitForPort(4321);
    return 'http://127.0.0.1:4321';
  } else {
    console.log('Starting production Astro server...');
    const port = await findFreePort(4321);
    process.env.PORT = port.toString();
    process.env.HOST = '127.0.0.1';

    // Import the built Astro Node server entry point
    const serverEntry = path.resolve(__dirname, '../dist/server/entry.mjs');
    if (!fs.existsSync(serverEntry)) {
      throw new Error(`Astro build output not found at ${serverEntry}. Please run build first.`);
    }
    await import(fileURLToPath(serverEntry));

    // Wait for production server to start
    await waitForPort(port);
    return `http://127.0.0.1:${port}`;
  }
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'Weather Forecast',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  mainWindow.loadURL(url);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    const serverUrl = await startServer();
    createWindow(serverUrl);
  } catch (error) {
    console.error('Failed to start application:', error);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (devServerProcess) {
    devServerProcess.kill();
  }
});
