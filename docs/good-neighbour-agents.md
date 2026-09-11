# Meet Larboard’s Good Neighbour Agents

Communities run on people who organize, help, listen, and follow through. Larboard’s Good Neighbour agents are designed to support that work by making local coordination simpler.

Visit [larboard.ca](https://larboard.ca) and send a community-support request, such as:

> Help organize volunteers for a food-bank shift.

Or:

> Create a simple mutual-aid intake checklist.

Larboard’s agents can help turn rough ideas into practical plans, checklists, volunteer instructions, public-facing messages, and clear next steps.

## Community roles

- `food-bank` — organizes volunteer shifts, pantry operations, donations, and pickup plans.
- `nonprofit-helpdesk` — helps small organizations draft policies, forms, agendas, and operating materials.
- `mutual-aid` — structures requests, offers, resource sharing, and safe follow-up.
- `civic-knowledge` — explains local services and public processes in plain language.

Developers can test each role directly through the API:

```bash
curl -X POST https://larboard.ca/api/ask \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "food-bank",
    "message": "Help organize volunteers for Saturday morning."
  }'
```

Try replacing `food-bank` with `nonprofit-helpdesk`, `mutual-aid`, or `civic-knowledge`.

Larboard is built with a Cloudflare Worker, Amazon Bedrock, shared agent profiles, Markdown skills, and persistent session storage. When the Python AgentCore runtime is enabled, responses identify `"runtime": "agentcore"` so teams can verify which execution path handled their request.

The goal is practical: reduce repetitive administration, preserve local knowledge, and give grassroots leaders more time to focus on people.

## Publication checklist

Before publishing this post, confirm that the Worker is deployed, the four profiles are present at `/api/agents`, AWS credentials are configured, and `AGENTCORE_RUNTIME_ARN` is wired into the deployed Worker if Python routing is being advertised.
