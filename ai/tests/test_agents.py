"""Offline startup and invocation tests for the EC2 peer agents."""
import asyncio
import importlib
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path


AGENTS_DIR = Path(__file__).resolve().parents[1] / "agents"
if str(AGENTS_DIR) not in sys.path:
    sys.path.insert(0, str(AGENTS_DIR))


class FakeSessionManager:
    instances = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.__class__.instances.append(self)


class FakeModelAgent:
    instances = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.__class__.instances.append(self)

    async def stream_async(self, prompt):
        yield SimpleNamespace(text=f"mock response to: {prompt}")


AGENT_CONFIG = {
    "agy": {
        "AGY_INVOKE_TOKEN": "agy-token",
        "AGY_MODEL": "mock-agy-model",
        "GOOGLE_API_KEY": "mock-google-key",
        "AGENT_SESSION_BUCKET": "mock-agy-sessions",
    },
    "kiro": {
        "KIRO_INVOKE_TOKEN": "kiro-token",
        "KIRO_MODEL": "mock-kiro-model",
        "AGENT_SESSION_BUCKET": "mock-kiro-sessions",
    },
    "codex": {
        "CODEX_INVOKE_TOKEN": "codex-token",
        "CODEX_MODEL": "mock-codex-model",
        "OPENAI_API_KEY": "mock-openai-key",
        "AGENT_SESSION_BUCKET": "mock-codex-sessions",
    },
}


class AgentStartupAndInvocationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        FakeSessionManager.instances.clear()
        FakeModelAgent.instances.clear()

    def load_agent(self, agent_id):
        return importlib.import_module(f"{agent_id}.main")

    def test_health_requires_the_shared_session_bucket(self):
        for agent_id, config in AGENT_CONFIG.items():
            with self.subTest(agent=agent_id), patch.dict(os.environ, config, clear=True):
                module = self.load_agent(agent_id)
                response = module.health()
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.body[0:1], b"{")

                missing_bucket = dict(config)
                del missing_bucket["AGENT_SESSION_BUCKET"]
                with patch.dict(os.environ, missing_bucket, clear=True):
                    response = module.health()
                    self.assertEqual(response.status_code, 503)
                    self.assertIn("AGENT_SESSION_BUCKET", response.body.decode())

    async def test_startup_and_authenticated_invocation_use_mock_model_and_s3(self):
        for agent_id, config in AGENT_CONFIG.items():
            with self.subTest(agent=agent_id), patch.dict(os.environ, config, clear=True):
                module = self.load_agent(agent_id)
                with patch.object(module, "Agent", FakeModelAgent), patch.object(
                    module, "S3SessionManager", FakeSessionManager
                ):
                    agent = module.build_agent("session-123")
                    self.assertEqual(agent.kwargs["model_id"], config[f"{agent_id.upper()}_MODEL"])
                    self.assertEqual(
                        FakeSessionManager.instances[-1].kwargs["bucket"],
                        config["AGENT_SESSION_BUCKET"],
                    )

                    request = module.InvokeRequest(session_id="session-123", prompt="  hello  ")
                    response = await module.invoke(
                        request, authorization=f"Bearer {config[f'{agent_id.upper()}_INVOKE_TOKEN']}"
                    )
                    body = b"".join([
                        chunk.encode() if isinstance(chunk, str) else chunk
                        async for chunk in response.body_iterator
                    ])
                    self.assertEqual(body, b"mock response to: hello")
                    self.assertEqual(response.media_type, "text/plain")

    async def test_invocation_rejects_an_invalid_token_before_startup(self):
        for agent_id, config in AGENT_CONFIG.items():
            with self.subTest(agent=agent_id), patch.dict(os.environ, config, clear=True):
                module = self.load_agent(agent_id)
                request = module.InvokeRequest(session_id="session-123", prompt="hello")
                with self.assertRaises(module.HTTPException) as error:
                    await module.invoke(request, authorization="Bearer wrong-token")
                self.assertEqual(error.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
