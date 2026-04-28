# Skill: Service Status Monitoring

## Trigger
Activate when:
- Message asks if a service is "down", "up", "working", "offline", "outage"
- Message asks to check the status of OpenAI, GitHub, or other external APIs

## Behavior
1. You MUST classify this as an `EXECUTE_CODE` intent.
2. Your `snippet` should be a Node.js or Python script. **IMPORTANT:** The sandbox container has NO external dependencies. Do NOT use `require('node-fetch')` or `axios`. Use the built-in global `fetch()` for Node.js (Node 18+) or `urllib` for Python.
3. **OpenAI Endpoint:** If asked about OpenAI, ALWAYS fetch from `https://status.openai.com/api/v2/status.json`. This returns a JSON object where `status.description` will say "All Systems Operational" or detail an outage.
4. Your script should parse the JSON and print a clean, human-readable summary.

## Response Format
Because you are using `EXECUTE_CODE`, you only need to output the JSON intent with your code. The Sandbox Manager will execute your code and return the console output to the WhatsApp group automatically.
