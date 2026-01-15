
# To test websocket
```
curl -N -X POST http://localhost:4000/realtime \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Tell me a joke"}'
```

# To test Lava websocket
```
curl -N -X POST http://localhost:4000/realtime-lava \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Tell me a joke"}'
```