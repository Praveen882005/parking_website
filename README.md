# ParkSense — ESP32 Smart Parking Dashboard

A small, dependency-free Node.js website for an ESP32 + IR sensor parking prototype. It shows occupancy, active parking time, calculated fees, completed sessions, device heartbeat, and optional electrical readings. Data is saved locally in `data/parking-data.json`.

## Requirements
- Windows 10/11 (the commands below use Command Prompt; PowerShell also works)
- Git, to clone the project
- Node.js 18 or newer (npm is included with Node.js)
- For hardware: an ESP32 DevKit V1, a digital IR obstacle sensor, Arduino IDE 2.x, and a 2.4 GHz Wi-Fi network

The website uses only Node.js built-in modules. You do not need to run `npm install`.

## Set up and run the website
1. Install Git for Windows and Node.js LTS if they are not already installed. During Node.js setup, keep npm selected.
2. Open Command Prompt, PowerShell, or the VS Code terminal.
3. Clone the repository and enter its folder:

  ```bat
  git clone https://github.com/Praveen882005/parking_website.git
  cd parking_website
  ```

4. Confirm Node.js is version 18 or newer:

  ```bat
  node --version
  npm --version
  ```

5. Start the server:

  ```bat
  npm start
  ```

6. Open `http://localhost:3000` in a browser. Keep the terminal window open while using the dashboard; press `Ctrl+C` in it to stop the server.

The server creates `data/parking-data.json` automatically and saves parking history and settings there. This runtime data is excluded from Git. To use a different port, set the `PORT` environment variable before running `npm start` (for example, `set PORT=3001` in Command Prompt).

## Test without hardware
1. Open the dashboard at `http://localhost:3000`.
2. Select **Simulate vehicle entry** and confirm the active timer and fee begin updating.
3. Select **Simulate vehicle exit** and confirm the session appears in history.

These demo controls update the local server only; they do not control the ESP32.

## Connect the ESP32 and sensor
### Wire the sensor
1. Disconnect USB power while wiring.
2. Connect the IR sensor's digital output (OUT/DO) to ESP32 GPIO 27.
3. Connect sensor GND to ESP32 GND.
4. Connect sensor VCC to a voltage supported by both the sensor and ESP32 input. The ESP32 GPIO is 3.3 V logic; never connect a 5 V output signal directly to a GPIO. Use a level shifter or appropriate divider if the sensor output is 5 V.
5. Mount and aim the sensor so its digital output changes reliably when a vehicle or test object is present. The sketch assumes an active-LOW sensor; change `DETECTED_LEVEL` from `LOW` to `HIGH` if yours is active HIGH.

### Configure Arduino IDE
1. Install Arduino IDE 2.x from the official Arduino website and open it.
2. In **File > Preferences**, add Espressif's stable ESP32 Boards Manager URL to **Additional boards manager URLs**: `https://espressif.github.io/arduino-esp32/package_esp32_index.json`. If other URLs are already present, separate entries with commas.
3. Open **Tools > Board > Boards Manager**, search for `esp32`, and install **esp32 by Espressif Systems**.
4. Open `esp32/esp32_parking/esp32_parking.ino` from the cloned project.
5. Replace `YOUR_WIFI_NAME` and `YOUR_WIFI_PASSWORD` in the sketch with the 2.4 GHz Wi-Fi network name and password. Keep these private; do not commit real credentials to a public repository.
6. Find the laptop's IPv4 address: run `ipconfig` in Command Prompt and note **IPv4 Address** under the connected Wi-Fi adapter (for example, `192.168.1.100`). In `API_URL`, replace `YOUR_LAPTOP_IP` with that address. Keep port `3000` and path `/api/sensor`.
7. In **Tools > Board**, select your ESP32 board (for many DevKit V1 boards, **ESP32 Dev Module** works). Connect the ESP32 by USB and select its port under **Tools > Port**.
8. Start the Node.js server on the laptop with `npm start` before testing the board. The laptop and ESP32 must be on the same local Wi-Fi network.
9. Click **Verify** in Arduino IDE, then **Upload**. If upload fails, select the correct port and hold the board's **BOOT** button while upload begins if your board requires it.
10. Open **Tools > Serial Monitor**, set the baud rate to **115200**, and check for Wi-Fi connection messages and successful HTTP status codes.
11. If Windows Firewall asks, allow Node.js on private networks. Do not expose port 3000 to the public internet.

The sketch uses only the ESP32 Arduino core libraries `WiFi.h` and `HTTPClient.h`; ArduinoJson is not required.

### Confirm the hardware connection
1. With the server running, open `http://localhost:3000/api/health` on the laptop. A healthy server responds with JSON containing `"ok":true`.
2. Check the Serial Monitor for `API HTTP status: 200` after the ESP32 sends a reading.
3. Return to the dashboard. The device should show as connected after its first reading. Move an object in and out of the sensor range to test occupancy and session recording.

If the ESP32 cannot connect, recheck the Wi-Fi name/password, laptop IP, sensor logic level, same-network requirement, Windows Firewall permission, and that the server is still running. Laptop IP addresses can change after reconnecting to Wi-Fi; update `API_URL` if that happens.

## API endpoints
- `GET /api/health` — health check
- `GET /api/status` — current status and metrics
- `GET /api/history?limit=100&status=all&date=YYYY-MM-DD` — sessions
- `GET /api/reports/daily?days=7` — daily revenue summary
- `POST /api/sensor` — ESP32 reading
- `POST /api/config` — update parking rate and offline timeout
- `POST /api/demo` — demo-only enter/exit controls

Example sensor JSON:
```json
{
  "occupied": true,
  "raw": 0,
  "rssi": -54,
  "uptimeSeconds": 128
}
```

Optional electrical fields can be included only when measured by appropriate hardware:
```json
{
  "occupied": true,
  "raw": 0,
  "voltage": 5.0,
  "current": 0.4,
  "power": 2.0,
  "energyWh": 0.05
}
```

## Important details
- Default tariff is ₹30 per started hour. 10 minutes costs ₹30; 61 minutes costs ₹60.
- A vehicle session starts when the backend receives `occupied: true` and ends when it receives `occupied: false`.
- The IR sensor only detects an object. It does not measure voltage, current, watts, or energy.
- The default sketch treats LOW as detected. If your module's output logic is reversed, change `DETECTED_LEVEL` to `HIGH`.
- GPIO pins are 3.3 V logic. Do not connect a 5 V sensor output directly to an ESP32 input.
- The server is a local prototype, not a hardened public production service. Do not expose it to the internet without authentication and security work.
