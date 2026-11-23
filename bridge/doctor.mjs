import { BridgeClient } from './client.mjs';
try { const status = await new BridgeClient().ensure(); console.log(JSON.stringify(status, null, 2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
