# EC2 deployment

Eight profiles share one bounded agent harness and invoke the language specialist as a nested agent. One EC2 host runs the Node server and React site. This deploys the Node execution path; it does not change the Cloudflare Worker or Python AgentCore runtime.

Deployment status (2026-09-12): live smoke evaluations passed for all nine roles. AWS denied `cloudformation:ValidateTemplate` and `cloudformation:CreateChangeSet` for the configured identity, so no EC2 stack was created. Deployment requires a role authorized for the operations below. The template has not been validated by the CloudFormation service.

Run `npm test`, `npm run check`, `npm run build`, and `npm run eval:agents`. The last command invokes real Bedrock models and prints JSON lines containing responses, tool traces, and call counts. Passing smoke checks is not a guarantee of factual correctness; review the output.

Initial deployment (AWS CLI credentials need CloudFormation, EC2, IAM role/profile creation and PassRole, S3, and SSM access):

```bash
AWS_REGION=ca-central-1 VPC_ID=vpc-example SUBNET_ID=subnet-example bash deploy/ec2/deploy.sh
```

The subnet must have outbound internet access and assign a public IP, or provide NAT. The security group has no inbound rules. The host uses IMDSv2, an instance role, encrypted disk, a private versioned release bucket, automatic container restart, bounded logs, and persistent local session storage. EC2 and Bedrock charges apply. Session data is lost if the instance is replaced; back up `/var/lib/larboard` before replacement.

The initial bootstrap waits up to 20 minutes for the release, builds the Docker image, runs offline checks, and starts the service. Stack creation alone does **not** prove application health. Check `/var/log/cloud-init-output.log` and `docker logs larboard` with Systems Manager if it fails.

Verify readiness using an SSM command on the output InstanceId:

```bash
aws ssm send-command --region ca-central-1 --instance-ids INSTANCE_ID --document-name AWS-RunShellScript --parameters 'commands=["docker inspect --format={{.State.Health.Status}} larboard","curl --fail http://127.0.0.1:3000/api/health"]'
aws ssm get-command-invocation --region ca-central-1 --command-id COMMAND_ID --instance-id INSTANCE_ID
```

Access the UI through an SSM tunnel (AWS Session Manager plugin required):

```bash
aws ssm start-session --region ca-central-1 --target INSTANCE_ID --document-name AWS-StartPortForwardingSession --parameters '{"portNumber":["3000"],"localPortNumber":["3000"]}'
```

Open http://localhost:3000. This is a private preview deployment. Public hosting requires a TLS endpoint and application authentication.

`deploy.sh` uploads new releases but bootstrap only runs on first launch. For an existing instance, rebuild the uploaded release through SSM during a maintenance window and retain the previous image for rollback; rerunning the script alone does not restart an existing container. The S3 bucket is retained when deleting the stack, so release history remains recoverable and continues incurring storage costs.

AWS reference: https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-ec2-instance-metadataoptions.html
