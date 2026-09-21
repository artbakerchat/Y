# Deploy the Website

Since you have a Node.js backend (not just static), you need to deploy the full app. Here are your options:

Option 1: Vercel (Easiest)

npm i -g vercel
vercel
- Free tier available
- Auto-deploys on push to main
- Good for Node.js backends

Option 2: Railway (Recommended for Node.js)

- Connect GitHub repo
- Auto-deploys on push
- Simple environment variables for AWS credentials
- Good free tier: https://railway.app

Option 3: AWS App Runner

- Deploy Docker container
- Keep using AWS Bedrock
- Pay-as-you-go pricing

Option 4: Render

- Free tier with auto-deploys
- Simple GitHub integration
- https://render.com

---

Local Testing First

Before deploying, test locally:

cd site && npm install && npm run build
cd .. && npm install && npm start

Then open http://localhost:3000

Need help setting up deployment? Which platform interests you most?

# Bee Chat

A lightweight, mobile-first AI chat interface powered by Amazon Nova and integrated with the Bee AI device. Built for simplicity and performance.

## Features

- **Mobile-optimized UI** — Clean, responsive chat interface designed for mobile devices
- **Nova AI Backend** — AWS Bedrock Nova model for intelligent responses
- **Music Integration** — Python-based music processing for Bee device
- **Session Management** — Persistent conversation history (48-hour TTL)
- **Minimal Architecture** — Simple, focused codebase with minimal dependencies

## Tech Stack

- **Frontend**: React + Vite + TypeScript
- **Backend**: Node.js 22+
- **AI Model**: Amazon Nova (AWS Bedrock)
- **Music Processing**: Python
- **Storage**: Local file-based sessions

## Quick Start

### Prerequisites

- Node.js 22+
- AWS credentials configured locally
- Amazon Bedrock access

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file:

```env
AWS_REGION=ca-central-1
BEDROCK_MODEL_ID=ca.amazon.nova-lite-v1:0
PORT=3000
```

### Development

```bash
npm run build    # Build React frontend
npm run dev      # Start development server
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
Bee Chat/
├── site/
│   └── src/
│       ├── App.tsx           # Chat UI component
│       ├── main.tsx          # React entry point
│       └── styles.css        # Mobile chat styles
├── api/
│   ├── chat.js              # Nova chat handler
│   └── music.js             # Bee device integration
├── models/
│   └── session.js           # Session data model
├── music.py                 # Music processing for Bee
├── server.mjs              # HTTP server
├── package.json
└── .env
```

## API Endpoints

### POST `/api/chat`

Send a message to Nova and get a response.

```javascript
{
  message: "Hello, how are you?",
  history: [
    { role: "user", content: "..." },
    { role: "assistant", content: "..." }
  ]
}
```

Response:

```javascript
{
  content: "I'm doing well, thank you for asking!"
}
```

## Music Integration

The `music.py` module handles music processing for the Bee AI device:

```python
python music.py < session_data.json
```

Processes session data and outputs JSON with device-ready audio information.

## Session Storage

Sessions are stored in `.data/sessions/` as JSON files with a 48-hour expiration TTL. Sessions are automatically cleaned up when expired.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AWS_REGION` | `ca-central-1` | AWS region for Bedrock |
| `BEDROCK_MODEL_ID` | `ca.amazon.nova-lite-v1:0` | Nova model ID |
| `PORT` | `3000` | Server port |

## Building for Production

```bash
npm run build
npm start
```

The server will serve the built frontend and API endpoints.

## License

MIT
