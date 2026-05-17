# Garden Glasses Session — Detailed Flows

## Flow 1 — Voice command to HA
```
User says: "Check the moisture in zone 2"
→ transcription event
→ sanitize (strip prompt injection)
→ parse intent: { action: "sensor_read", zone: "2", sensor: "soil_moisture" }
→ validate zone against user's permitted zones
→ call HA REST API
→ format response
→ speak: "Zone 2 soil moisture is 42 percent. Watering recommended."
```

## Flow 2 — Photo analysis
```
User presses button on glasses
→ onButtonPress triggers camera capture
→ photo received as base64
→ validate: check magic bytes (JPEG/PNG only)
→ encrypt + store with plantId + timestamp
→ send to Claude Vision with garden expert system prompt
→ Claude returns: { diagnosis, severity, recommendations, annotationPoints }
→ speak summary through glasses: "I see early signs of powdery mildew on the upper leaves..."
→ push annotated photo + full report to phone app via WebSocket
```

## Flow 3 — Proactive alert
```
HA webhook: soil moisture in zone 3 below threshold
→ validate HMAC signature
→ look up user for that zone
→ if glasses connected: speak alert
→ push notification to phone app
→ audit log: { action: "proactive_alert", zone: "3", trigger: "soil_moisture_low" }
```
