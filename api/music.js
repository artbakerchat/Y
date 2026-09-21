import { spawn } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = import.meta.url.split('/').slice(0, -1).join('/').slice(7);
const musicPyPath = join(__dirname, '..', 'music.py');

export async function processMusicSession(sessionData) {
  return new Promise((resolve, reject) => {
    const python = spawn('python3', [musicPyPath], {
      cwd: join(__dirname, '..'),
    });

    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    python.on('close', (code) => {
      if (code === 0) {
        resolve({
          success: true,
          message: output,
          sessionData,
        });
      } else {
        reject(new Error(`Python script failed: ${errorOutput}`));
      }
    });

    python.on('error', (err) => {
      reject(err);
    });

    if (sessionData) {
      python.stdin.write(JSON.stringify(sessionData));
    }
    python.stdin.end();
  });
}

export async function sendToBeeMusicDevice(audioData) {
  // Placeholder for actual Bee device integration
  // This would handle sending processed music/audio to the Bee AI device
  return {
    success: true,
    message: 'Audio sent to Bee device',
    timestamp: new Date().toISOString(),
  };
}
