#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${VPC_ID:?Set VPC_ID to the target VPC}"
: "${SUBNET_ID:?Set SUBNET_ID to a subnet with outbound internet access}"
DEPLOY_REGION="${AWS_REGION:-ca-central-1}"
STACK_NAME="${LARBOARD_STACK_NAME:-larboard-agents}"
if [ "$DEPLOY_REGION" != ca-central-1 ]; then
  echo 'This template is validated for ca-central-1 and the Canadian Nova Lite inference profile.' >&2
  exit 1
fi
npm test
npm run check
npm run build
archive_dir=$(mktemp -d /tmp/larboard-release.XXXXXX)
tar -czf "$archive_dir/release.tgz" --exclude=node_modules --exclude=site/node_modules --exclude=site/dist \
  package.json package-lock.json server.mjs src tools agentcore/profiles.js \
  app/ForgeAgent/profiles.json app/ForgeAgent/forge_profiles.py \
  scripts tests skills site deploy/ec2 .dockerignore
aws cloudformation deploy --region "$DEPLOY_REGION" --stack-name "$STACK_NAME" \
  --template-file deploy/ec2/template.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides "VpcId=$VPC_ID" "SubnetId=$SUBNET_ID" --no-fail-on-empty-changeset
bucket=$(aws cloudformation describe-stacks --region "$DEPLOY_REGION" --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[?OutputKey==`ArtifactBucket`].OutputValue|[0]' --output text)
aws s3 cp "$archive_dir/release.tgz" "s3://$bucket/release.tgz" --region "$DEPLOY_REGION"
instance=$(aws cloudformation describe-stacks --region "$DEPLOY_REGION" --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue|[0]' --output text)
echo "Uploaded release. Instance: $instance. Bootstrap builds and tests the image; allow several minutes."
echo "Archive retained at $archive_dir/release.tgz"
echo "Use the health verification and SSM access commands in deploy/ec2/README.md."
