"""Package and deploy Forge directly to AgentCore, without CloudFormation.

Install ARM64 dependencies into .data/agentcore-package before running.
An existing execution role and artifact bucket must be supplied explicitly.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import zipfile

import boto3


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bucket', required=True)
    parser.add_argument('--role-arn', required=True)
    parser.add_argument('--region', default='ca-central-1')
    parser.add_argument('--name', default='larboard_forge_agents')
    parser.add_argument('--package-only', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    dependencies = root / '.data/agentcore-package'
    if not (dependencies / 'strands').is_dir():
        raise SystemExit('Build the ARM64 dependencies first; see deploy/agentcore/README.md')
    archive = root / '.data/agentcore-runtime.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as target:
        for base in [dependencies, root / 'app/ForgeAgent']:
            for path in sorted(base.rglob('*')):
                if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc':
                    target.write(path, path.relative_to(base))
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    print(json.dumps({'package': str(archive), 'bytes': archive.stat().st_size, 'sha256': digest}), flush=True)
    if args.package_only:
        return
    client = boto3.client('bedrock-agentcore-control', region_name=args.region)
    # Never update a runtime by name alone. Existing deployments require a
    # locally recorded ID from this script and matching name before update.
    state_path = root / '.data/agentcore-deployment.json'
    existing = json.loads(state_path.read_text()) if state_path.exists() else None
    if existing:
        details = client.get_agent_runtime(agentRuntimeId=existing['agentRuntimeId'])
        if details['agentRuntimeName'] != args.name:
            raise SystemExit('Recorded runtime does not match requested name')
    key = f'larboard/releases/{digest}.zip'
    boto3.client('s3', region_name=args.region).upload_file(str(archive), args.bucket, key)
    options = dict(
        agentRuntimeArtifact={'codeConfiguration': {'code': {'s3': {'bucket': args.bucket, 'prefix': key}}, 'runtime': 'PYTHON_3_12', 'entryPoint': ['main.py']}},
        roleArn=args.role_arn,
        networkConfiguration={'networkMode': 'PUBLIC'},
        protocolConfiguration={'serverProtocol': 'HTTP'},
        environmentVariables={'BEDROCK_MODEL_ID': os.getenv('BEDROCK_MODEL_ID', 'ca.amazon.nova-lite-v1:0')},
        description='Larboard eight agent profiles and bounded language specialist',
    )
    if existing:
        result = client.update_agent_runtime(agentRuntimeId=existing['agentRuntimeId'], **options)
    else:
        result = client.create_agent_runtime(agentRuntimeName=args.name, **options)
    record = {key: result[key] for key in ['agentRuntimeId', 'agentRuntimeArn', 'status']}
    record.update(region=args.region, artifact_key=key)
    state_path.write_text(json.dumps(record, indent=2))
    print(json.dumps(record), flush=True)
    print('Deployment submitted. Wait for READY, then run evaluate_agentcore.py --runtime-arn with the recorded ARN.')


if __name__ == '__main__':
    main()
