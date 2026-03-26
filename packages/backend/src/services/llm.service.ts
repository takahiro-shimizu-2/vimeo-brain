import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export class LlmService {
  async complete(prompt: string): Promise<string> {
    if (config.LLM_PROVIDER === 'anthropic') {
      return this.completeAnthropic(prompt);
    }
    return this.completeOpenAI(prompt);
  }

  private async completeAnthropic(prompt: string): Promise<string> {
    if (!config.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY required');
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': config.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body }, 'Anthropic API error');
      throw new Error(`Anthropic API error: ${res.status}`);
    }

    const data = (await res.json()) as {
      content: Array<{ text: string }>;
    };
    return data.content[0]?.text || '';
  }

  private async completeOpenAI(prompt: string): Promise<string> {
    if (!config.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY required');
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4096,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body }, 'OpenAI API error');
      throw new Error(`OpenAI API error: ${res.status}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content || '';
  }
}
