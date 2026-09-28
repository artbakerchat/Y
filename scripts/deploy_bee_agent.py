"""Package and deploy the Y BeeAgent runtime to AgentCore, without CloudFormation.

The BeeAgent runtime serves the public Bee-connect website: device-flow
pairing plus a Strands chat agent with the full beeplex tool set.

Usage:
  1. Build the ARM64 dependencies once:
       pip install --platform manylinux2014_aarch64 --python-version 3.12 \\
         --only-binary=:all: --target .data/beeagent-package \\
         boto3 bedrock-agentcore "strands-agents>=1.55.1" python-dotenv \\
         "mcp>=2,<3" "openpyxl>=3.1,<4" "python-docx>=1.1,<2" "python-pptx>=1,<2"
  2. Package (and optionally deploy):
       python3 scripts/deploy_bee_agent.py --package-only
       python3 scripts/deploy_bee_agent.py --bucket <bucket> --role-arn <arn>

The linux-arm64 Bee CLI binary is fetched from the @beeai/cli npm tarball
at package time (pinned version via --bee-cli-version); the beeplex python
package is copied from the vendored beeplex/python directory.
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path
import zipfile

import boto3

BEE_CLI_VERSION = '0.7.3'
STATE_FILE = '.data/beeagent-deployment.json'


def _fetch_bee_binary(root: Path, version: str, dest: Path) -> None:
    """Extract the linux-arm64 bee binary from the @beeai/cli npm tarball."""
    if dest.exists():
        print(f'Bee binary already staged: {dest}', flush=True)
        return
    with tempfile.TemporaryDirectory() as tmp:
        print(f'Downloading @beeai/cli@{version} tarball...', flush=True)
        subprocess.run(
            ['npm', 'pack', f'@beeai/cli@{version}', '--pack-destination', tmp],
            check=True, capture_output=True, text=True,
        )
        tarballs = list(Path(tmp).glob('*.tgz'))
        if not tarballs:
            raise SystemExit('npm pack produced no tarball')
        member = 'package/dist/platforms/linux-arm64/bee'
        with tarfile.open(tarballs[0], 'r:gz') as tar:
            info = tar.getmember(member)
            info.name = dest.name
            tar.extract(info, path=dest.parent)
    dest.chmod(0o755)
    print(f'Staged Bee binary: {dest} ({dest.stat().st_size} bytes)', flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bucket', required=False)
    parser.add_argument('--role-arn', required=False)
    parser.add_argument('--region', default='ca-central-1')
    parser.add_argument('--name', default='y_bee_agent')
    parser.add_argument('--bee-cli-version', default=BEE_CLI_VERSION)
    parser.add_argument('--package-only', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]

    dependencies = root / '.data/beeagent-package'
    if not (dependencies / 'strands').is_dir():
        raise SystemExit('Build the ARM64 dependencies first; see the module docstring.')

    staged_bee = root / '.data/bee-arm64'
    _fetch_bee_binary(root, args.bee_cli_version, staged_bee)

    beeplex_pkg = root / 'beeplex' / 'python'
    if not (beeplex_pkg / 'cli.py').is_file():
        raise SystemExit(f'beeplex python package not found at {beeplex_pkg}')

    archive = root / '.data/beeagent-runtime.zip'
    if archive.exists():
        archive.unlink()
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as target:
        # ARM64 site-packages at the zip root.
        for base in [dependencies]:
            for path in sorted(base.rglob('*')):
                if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc':
                    target.write(path, path.relative_to(base))
        # BeeAgent app modules at the zip root (main.py is the entry point).
        app_dir = root / 'app' / 'BeeAgent'
        for mod in ('main.py', 'bee_pairing.py', 'bee_chat.py', 'bee_tools.py'):
            target.write(app_dir / mod, mod)
        # Vendored beeplex package as top-level `python/` (so `python -m python` works).
        for path in sorted(beeplex_pkg.rglob('*')):
            if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc':
                target.write(path, Path('python') / path.relative_to(beeplex_pkg))
        # Bee CLI binary at the zip root as `bee` (chmod 755 applied at startup).
        target.write(staged_bee, 'bee')

    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    print(json.dumps({'package': str(archive), 'bytes': archive.stat().st_size, 'sha256': digest}), flush=True)
    if args.package_only:
        return
    if not args.bucket or not args.role_arn:
        raise SystemExit('--bucket and --role-arn are required to deploy')

    client = boto3.client('bedrock-agentcore-control', region_name=args.region)
    state_path = root / STATE_FILE
    existing = json.loads(state_path.read_text()) if state_path.exists() else None
    if existing:
        details = client.get_agent_runtime(agentRuntimeId=existing['agentRuntimeId'])
        if details['agentRuntimeName'] != args.name:
            raise SystemExit('Recorded runtime does not match requested name')
    key = f'beeagent/releases/{digest}.zip'
    boto3.client('s3', region_name=args.region).upload_file(str(archive), args.bucket, key)
    options = dict(
        agentRuntimeArtifact={'codeConfiguration': {'code': {'s3': {'bucket': args.bucket, 'prefix': key}}, 'runtime': 'PYTHON_3_12', 'entryPoint': ['main.py']}},
        roleArn=args.role_arn,
        networkConfiguration={'networkMode': 'PUBLIC'},
        protocolConfiguration={'serverProtocol': 'HTTP'},
        environmentVariables={'BEDROCK_MODEL_ID': os.getenv('BEDROCK_MODEL_ID', 'ca.amazon.nova-lite-v1:0')},
        description='Y public website: Bee device pairing + beeplex chat agent',
    )
    if existing:
        result = client.update_agent_runtime(agentRuntimeId=existing['agentRuntimeId'], **options)
    else:
        result = client.create_agent_runtime(agentRuntimeName=args.name, **options)
    record = {key: result[key] for key in ['agentRuntimeId', 'agentRuntimeArn', 'status']}
    record.update(region=args.region, artifact_key=key)
    state_path.write_text(json.dumps(record, indent=2))
    print(json.dumps(record), flush=True)
    print('Deployment submitted. Wait for READY before invoking.', flush=True)


if __name__ == '__main__':
    main()
