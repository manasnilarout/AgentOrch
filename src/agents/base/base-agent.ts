import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import {
  AgentContext,
  AgentResult,
  NextAction,
  DomainEvent,
  AgentName,
  AGENT_PIPELINE,
  TokenUsage,
} from '../../shared/types/agent.types.js';
import { RfqState } from '../../shared/types/rfq.types.js';
import { config } from '../../config/index.js';
import { logger } from '../../shared/utils/logger.js';

// Tool definition type
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Tool handler type
export type ToolHandler = (
  input: Record<string, unknown>,
  context: AgentContext
) => Promise<string>;

export abstract class BaseAgent<TOutput = unknown> {
  protected agentName: AgentName;
  protected client: Anthropic;
  protected tools: Map<string, { definition: ToolDefinition; handler: ToolHandler }> = new Map();

  constructor(agentName: AgentName) {
    this.agentName = agentName;
    this.client = new Anthropic({
      apiKey: config.anthropic.apiKey,
    });
  }

  /**
   * Register a tool for the agent
   */
  protected registerTool(
    name: string,
    description: string,
    inputSchema: ToolDefinition['input_schema'],
    handler: ToolHandler
  ): void {
    this.tools.set(name, {
      definition: { name, description, input_schema: inputSchema },
      handler,
    });
  }

  /**
   * Main execution method - orchestrates the agent workflow
   */
  async execute(context: AgentContext): Promise<AgentResult<TOutput>> {
    const events: DomainEvent[] = [];
    const startTime = Date.now();

    logger.info(
      { executionId: context.executionId, agent: this.agentName },
      'Agent execution started'
    );

    try {
      events.push(this.createEvent('AGENT_STARTED', { agent: this.agentName }));

      // Initialize agent-specific tools
      this.initializeTools(context);

      // Build prompts using templating engine
      const systemPrompt = this.buildSystemPrompt(context);
      const userPrompt = this.buildUserPrompt(context);

      // Execute the agent loop
      const result = await this.runAgentLoop(systemPrompt, userPrompt, context, events);

      // Parse and validate output
      const parsedOutput = await this.parseOutput(result.finalResponse, context);

      // Determine next action
      const nextAction = this.determineNextAction(parsedOutput, context);

      const durationMs = Date.now() - startTime;

      events.push(
        this.createEvent('AGENT_COMPLETED', {
          agent: this.agentName,
          durationMs,
          tokenUsage: result.tokenUsage,
          costUsd: result.costUsd,
        })
      );

      logger.info(
        { executionId: context.executionId, agent: this.agentName, durationMs },
        'Agent execution completed'
      );

      return {
        success: true,
        outputState: parsedOutput.state,
        events,
        nextAction,
        agentOutput: parsedOutput.output as TOutput,
        metadata: {
          durationMs,
          tokenUsage: result.tokenUsage,
          costUsd: result.costUsd,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      events.push(
        this.createEvent('AGENT_FAILED', {
          agent: this.agentName,
          error: errorMessage,
          durationMs,
        })
      );

      logger.error(
        { executionId: context.executionId, agent: this.agentName, error: errorMessage },
        'Agent execution failed'
      );

      return {
        success: false,
        outputState: {},
        events,
        nextAction: { type: 'FAIL', error: errorMessage },
        metadata: { durationMs },
      };
    }
  }

  /**
   * Execute the agent loop with tool calling
   */
  private async runAgentLoop(
    systemPrompt: string,
    userPrompt: string,
    context: AgentContext,
    events: DomainEvent[]
  ): Promise<{ finalResponse: string; tokenUsage: TokenUsage; costUsd: number }> {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userPrompt }];

    const toolDefinitions = Array.from(this.tools.values()).map((t) => t.definition);

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let turns = 0;
    const maxTurns = config.agent.maxTurns;

    while (turns < maxTurns) {
      turns++;

      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: systemPrompt,
        messages,
        tools: toolDefinitions.length > 0 ? toolDefinitions as Anthropic.Tool[] : undefined,
      });

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      // Check if we need to handle tool calls
      if (response.stop_reason === 'tool_use') {
        const assistantContent: Anthropic.ContentBlock[] = response.content;
        messages.push({ role: 'assistant', content: assistantContent });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type === 'tool_use') {
            const tool = this.tools.get(block.name);
            if (tool) {
              events.push(
                this.createEvent('TOOL_INVOKED', {
                  tool: block.name,
                  input: block.input,
                })
              );

              try {
                const result = await tool.handler(block.input as Record<string, unknown>, context);
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: result,
                });

                events.push(
                  this.createEvent('TOOL_COMPLETED', {
                    tool: block.name,
                    resultLength: result.length,
                  })
                );
              } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: `Error: ${errorMsg}`,
                  is_error: true,
                });

                events.push(
                  this.createEvent('TOOL_FAILED', {
                    tool: block.name,
                    error: errorMsg,
                  })
                );
              }
            }
          }
        }

        messages.push({ role: 'user', content: toolResults });
      } else {
        // Agent is done - extract final text response
        let finalResponse = '';
        for (const block of response.content) {
          if (block.type === 'text') {
            finalResponse += block.text;
          }
        }

        // Calculate approximate cost (Claude Sonnet pricing)
        const costUsd = (totalInputTokens * 0.003 + totalOutputTokens * 0.015) / 1000;

        return {
          finalResponse,
          tokenUsage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          },
          costUsd,
        };
      }
    }

    throw new Error(`Agent exceeded maximum turns (${maxTurns})`);
  }

  /**
   * Get the next agent in the pipeline
   */
  protected getNextAgent(): AgentName | null {
    const currentIndex = AGENT_PIPELINE.indexOf(this.agentName);
    if (currentIndex === -1 || currentIndex === AGENT_PIPELINE.length - 1) {
      return null;
    }
    return AGENT_PIPELINE[currentIndex + 1];
  }

  /**
   * Helper: Continue to next agent in pipeline
   */
  protected continueToNextAgent(): NextAction {
    const nextAgent = this.getNextAgent();
    if (nextAgent) {
      return { type: 'CONTINUE', nextAgent };
    }
    return { type: 'COMPLETE' };
  }

  /**
   * Helper: Require human intervention
   */
  protected requireHumanIntervention(reason: string, requiredFields?: string[]): NextAction {
    return { type: 'AWAIT_HUMAN', reason, requiredFields };
  }

  /**
   * Helper: Skip to specific agent
   */
  protected skipToAgent(reason: string, nextAgent: AgentName): NextAction {
    return { type: 'SKIP', reason, nextAgent };
  }

  /**
   * Create a domain event
   */
  protected createEvent(type: string, data: Record<string, unknown>): DomainEvent {
    return {
      id: uuidv4(),
      eventType: type,
      eventData: data,
      createdAt: new Date(),
    };
  }

  /**
   * Extract JSON from agent response (handles markdown code blocks)
   */
  protected extractJsonFromResponse(response: string): unknown {
    // Try to extract JSON from markdown code block
    const jsonMatch = response.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }

    // Try parsing the whole response as JSON
    try {
      return JSON.parse(response);
    } catch {
      throw new Error('Could not extract structured output from agent response');
    }
  }

  // ============================================
  // Abstract methods - each agent implements these
  // ============================================

  /**
   * Initialize agent-specific tools
   */
  protected abstract initializeTools(context: AgentContext): void;

  /**
   * Build the system prompt for this agent
   */
  protected abstract buildSystemPrompt(context: AgentContext): string;

  /**
   * Build the user prompt for this agent
   */
  protected abstract buildUserPrompt(context: AgentContext): string;

  /**
   * Parse and validate the agent's output
   */
  protected abstract parseOutput(
    response: string,
    context: AgentContext
  ): Promise<{ state: Partial<RfqState>; output: unknown }>;

  /**
   * Determine the next action based on output
   */
  protected abstract determineNextAction(
    parsedOutput: { state: Partial<RfqState>; output: unknown },
    context: AgentContext
  ): NextAction;
}
