import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'ca-central-1' });
const modelId = process.env.BEDROCK_MODEL_ID || 'ca.amazon.nova-lite-v1:0';

export async function chat(message, history = []) {
  const messages = [
    ...history.map(msg => ({
      role: msg.role,
      content: msg.content,
    })),
    {
      role: 'user',
      content: message,
    },
  ];

  const command = new ConverseCommand({
    modelId,
    messages,
    system: 'You are a helpful AI assistant. Keep your responses concise and clear.',
  });

  try {
    const response = await client.send(command);
    const content = response.output?.message?.content?.[0]?.text || '';
    return { success: true, content };
  } catch (error) {
    console.error('Bedrock error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
