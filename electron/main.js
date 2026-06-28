import { app, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from .env
try {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
} catch (e) {
  console.warn('Could not load .env file:', e);
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
    // Spawn Astro dev server using the Node version bypass
    devServerProcess = spawn('node', [
      '-e',
      "process.argv = [process.argv[0], 'node_modules/astro/bin/astro.mjs', ...process.argv.slice(1)]; Object.defineProperty(process.versions, 'node', { value: '22.12.0' }); import('./node_modules/astro/bin/astro.mjs')",
      '--',
      'dev',
      '--port',
      '4321'
    ], {
      stdio: 'inherit',
      shell: true,
      cwd: path.resolve(__dirname, '..')
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
