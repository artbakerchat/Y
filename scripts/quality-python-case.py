"""One real AgentCore entrypoint call, used by the quality evaluation runner."""
import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app' / 'ForgeAgent'))
import main


async def run():
    payload = json.load(sys.stdin)
    payload.setdefault('mode', 'advanced')
    events = [event async for event in main.invoke(payload, SimpleNamespace(session_id=payload.pop('session')))]
    answer = ''.join(event.get('event', {}).get('contentBlockDelta', {}).get('delta', {}).get('text', '') for event in events)
    print(json.dumps({'answer': answer, 'agentId': payload['agent_id'], 'runtime': 'local-python-agentcore'}))


asyncio.run(run())
