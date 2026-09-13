import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app' / 'ForgeAgent'))
from community_tools import build_community_tools


class CivicSourceTests(unittest.TestCase):
    def test_supplied_verification_is_not_independent_evidence(self):
        tool = build_community_tools('civic-knowledge')[0]
        for url in ['https://example.org/', 'https://city.gov/', 'https://evil.test/city.gov/']:
            with self.subTest(url=url):
                result = json.loads(tool(sources=[{'url': url, 'verified': True}]))
                self.assertFalse(result['grounded'])
                self.assertFalse(result['sources'][0]['verified'])
                self.assertTrue(result['sources'][0]['claimedVerified'])
