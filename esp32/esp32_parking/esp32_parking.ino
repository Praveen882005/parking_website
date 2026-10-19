#include <WiFi.h>
#include <HTTPClient.h>

// Replace these with your Wi-Fi details.
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Replace 192.168.1.100 with your laptop's IPv4 address from ipconfig.
// Keep port 3000 and /api/sensor.
const char* API_URL = "http://YOUR_LAPTOP_IP:3000/api/sensor";

// IR sensor digital output is connected to GPIO 27.
// Many modules are active LOW. Change to HIGH if your module works oppositely.
const int IR_PIN = 27;
const int DETECTED_LEVEL = LOW;

unsigned long lastSendMs = 0;
const unsigned long SEND_INTERVAL_MS = 2000;

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 20000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi connected. ESP32 IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("Wi-Fi connection failed; will retry.");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(IR_PIN, INPUT);
  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();

  if (millis() - lastSendMs >= SEND_INTERVAL_MS) {
    lastSendMs = millis();
    int raw = digitalRead(IR_PIN);
    bool occupied = (raw == DETECTED_LEVEL);

    Serial.print("IR raw=");
    Serial.print(raw);
    Serial.print(" | occupied=");
    Serial.println(occupied ? "true" : "false");

    if (WiFi.status() == WL_CONNECTED) {
      HTTPClient http;
      http.begin(API_URL);
      http.addHeader("Content-Type", "application/json");

      // IR-only setup: no real power values are sent.
      String payload = "{";
      payload += "\"occupied\":";
      payload += (occupied ? "true" : "false");
      payload += ",\"raw\":";
      payload += String(raw);
      payload += ",\"rssi\":";
      payload += String(WiFi.RSSI());
      payload += ",\"uptimeSeconds\":";
      payload += String(millis() / 1000);
      payload += "}";

      int code = http.POST(payload);
      Serial.print("API HTTP status: ");
      Serial.println(code);
      if (code > 0) Serial.println(http.getString());
      else Serial.println("Could not reach API. Check laptop IP, firewall, and same Wi-Fi.");
      http.end();
    }
  }
  delay(10);
}
