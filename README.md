# Forge — Bedrock agent workspace

A small full-stack starter for a Strands agent backed by Amazon Bedrock. The browser talks only to the local Node server; AWS credentials are never sent to the client.

## Run it

1. Install Node.js 22+.
2. Run `npm install`.
3. Set AWS credentials using your normal AWS credential chain. Do not commit credentials.
4. Optionally copy `.env.example` to `.env` and set `AWS_REGION` and `BEDROCK_MODEL_ID`.
5. Run `npm start`, then open `http://localhost:3000`.

The server prefers Strands when its SDK is available and falls back to the Bedrock Converse API while keeping the same UI contract. Your IAM principal needs permission to invoke the selected Bedrock model.

In production, the Cloudflare Worker can use Amazon Bedrock AgentCore as the managed agent runtime. Set `AGENTCORE_RUNTIME_ARN` in the Worker environment; requests then flow through AgentCore, while direct Bedrock remains the fallback when the ARN is unset. The browser’s word palette is passed with each request so the AgentCore-hosted Strands harness can use it in tools and memory.

swift shadow mountain | copper whisper valley | silent echo forest | golden anchor harbour | crystal beacon summit | velvet compass prairie | iron current canyon | ember horizon glacier | mystic lantern desert | stellar mosaic tundra | lunar pathway island | solar tempest plateau | amber monolith jungle | fossil labyrinth meadow | neon sentinel basin | rust torrent zenith | velvet mirage estuary | frost citadel savanna | obsidian horizon archipelago | azure monolith reef | jade talisman ridge | cobalt beacon fjord | crimson tapestry valley | bronze pendulum canyon | silver cascade plateau | copper monolith tundra | golden labyrinth desert | iron sentinel prairie | steel compass mountain | titanium anchor island | platinum mosaic reef | marble tempest basin | granite echo jungle | basalt shadow savanna | limestone horizon glacier | quartz pathway estuary | opal citadel archipelago | pearl talisman ridge | ruby beacon fjord | sapphire tapestry valley | emerald pendulum canyon | topaz cascade plateau | garnet monolith tundra | amethyst labyrinth desert | turquoise sentinel prairie | peridot compass mountain | onyx anchor island | zircon mosaic reef | jasper tempest basin | malachite echo jungle | obsidian shadow savanna | hematite horizon glacier
