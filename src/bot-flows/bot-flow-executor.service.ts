import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BotFlow } from '../entities/bot-flow.entity';
import {
  BotConversationSession,
  type BotChatHistoryEntry,
} from '../entities/bot-conversation-session.entity';
import { GeminiService } from '../gemini/gemini.service';

export interface FlowGraphNode {
  id: string;
  type: string;
  data?: Record<string, unknown>;
}

export interface FlowGraphEdge {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string;
}

export interface BotOutgoingMessage {
  type: 'text' | 'photo';
  text?: string;
  photoUrl?: string;
}

@Injectable()
export class BotFlowExecutorService {
  private readonly logger = new Logger(BotFlowExecutorService.name);
  private readonly maxSteps = 30;

  constructor(
    @InjectRepository(BotConversationSession)
    private readonly sessionRepository: Repository<BotConversationSession>,
    private readonly geminiService: GeminiService,
  ) {}

  async processMessage(
    flow: BotFlow,
    chatId: string,
    userText: string,
  ): Promise<BotOutgoingMessage[]> {
    const trimmed = userText.trim();
    if (!trimmed) {
      return [{ type: 'text', text: 'Envie uma mensagem de texto para continuar.' }];
    }

    if (!this.isFlowActive(flow)) {
      return [{
        type: 'text',
        text: 'Este bot está inativo. Ative o fluxo no editor (toggle "Fluxo ativo") ou na tela de conexão.',
      }];
    }

    const nodes = this.parseJsonArray<FlowGraphNode>(flow.nodes);
    const edges = this.parseJsonArray<FlowGraphEdge>(flow.edges);

    let session = await this.sessionRepository.findOne({
      where: { botFlowId: flow.id, chatId },
    });

    if (!session) {
      session = this.sessionRepository.create({
        botFlowId: flow.id,
        chatId,
        history: [],
        status: 'active',
      });
    }

    if (trimmed === '/start') {
      session.currentNodeId = undefined;
      session.waitingAtNodeId = undefined;
      session.status = 'active';
      session.history = [];
    }

    const history = Array.isArray(session.history) ? [...session.history] : [];
    history.push({ role: 'user', text: trimmed });
    history.splice(0, Math.max(0, history.length - 20));

    const outputs: BotOutgoingMessage[] = [];

    if (nodes.length === 0) {
      const reply = await this.generateFreeformReply(flow, trimmed, history);
      outputs.push({ type: 'text', text: reply });
      await this.saveSession(session, history, outputs, null, null);
      return outputs;
    }

    let currentNode: FlowGraphNode | undefined;

    if (session.waitingAtNodeId) {
      const waitingNode = nodes.find((n) => n.id === session.waitingAtNodeId);
      if (waitingNode?.type === 'conditionNode') {
        const conditionResult = await this.evaluateCondition(waitingNode, trimmed, flow.name);
        const handle = conditionResult ? 'true' : 'false';
        const nextEdge = edges.find(
          (e) => e.source === waitingNode.id && (e.sourceHandle ?? 'true') === handle,
        );
        session.waitingAtNodeId = undefined;
        currentNode = nextEdge ? nodes.find((n) => n.id === nextEdge.target) : undefined;
      } else {
        session.waitingAtNodeId = undefined;
        currentNode = this.findStartNode(nodes, edges);
      }
    } else {
      currentNode = this.findStartNode(nodes, edges);
    }

    if (!currentNode) {
      const reply = await this.generateFreeformReply(flow, trimmed, history);
      outputs.push({ type: 'text', text: reply });
      await this.saveSession(session, history, outputs, null, null);
      return outputs;
    }

    let steps = 0;
    let lastNodeId: string | null = null;
    let waitingAt: string | null = null;

    while (currentNode && steps < this.maxSteps) {
      steps++;
      lastNodeId = currentNode.id;

      switch (currentNode.type) {
        case 'contextNode':
          currentNode = this.getNextNode(nodes, edges, currentNode.id);
          break;
        case 'messageNode': {
          const text = await this.resolveMessageNode(currentNode, flow, trimmed, history);
          if (text) {
            outputs.push({ type: 'text', text });
          }
          currentNode = this.getNextNode(nodes, edges, currentNode.id);
          break;
        }
        case 'imageNode': {
          const url = String(currentNode.data?.imageUrl ?? '').trim();
          if (url) {
            outputs.push({ type: 'photo', photoUrl: url });
          }
          currentNode = this.getNextNode(nodes, edges, currentNode.id);
          break;
        }
        case 'delayNode':
          currentNode = this.getNextNode(nodes, edges, currentNode.id);
          break;
        case 'conditionNode':
          waitingAt = currentNode.id;
          currentNode = undefined;
          break;
        default:
          currentNode = this.getNextNode(nodes, edges, currentNode.id);
          break;
      }
    }

    if (outputs.length === 0 && waitingAt) {
      outputs.push({
        type: 'text',
        text: 'Aguardando sua resposta...',
      });
    }

    if (outputs.length === 0) {
      const reply = await this.generateFreeformReply(flow, trimmed, history);
      outputs.push({ type: 'text', text: reply });
    }

    session.status = waitingAt ? 'waiting_input' : 'active';
    await this.saveSession(session, history, outputs, lastNodeId, waitingAt);

    return outputs;
  }

  private async saveSession(
    session: BotConversationSession,
    history: BotChatHistoryEntry[],
    outputs: BotOutgoingMessage[],
    currentNodeId: string | null,
    waitingAtNodeId: string | null,
  ): Promise<void> {
    for (const out of outputs) {
      if (out.type === 'text' && out.text) {
        history.push({ role: 'assistant', text: out.text });
      } else if (out.type === 'photo') {
        history.push({ role: 'assistant', text: '[imagem enviada]' });
      }
    }
    while (history.length > 20) {
      history.shift();
    }

    session.history = history;
    session.currentNodeId = currentNodeId ?? undefined;
    session.waitingAtNodeId = waitingAtNodeId ?? undefined;
    await this.sessionRepository.save(session);
  }

  private parseJsonArray<T>(value: unknown): T[] {
    if (Array.isArray(value)) return value as T[];
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? (parsed as T[]) : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private isFlowActive(flow: BotFlow): boolean {
    const value = flow.isActive as unknown;
    return value === true || value === 1 || value === '1';
  }

  private findStartNode(nodes: FlowGraphNode[], edges: FlowGraphEdge[]): FlowGraphNode | undefined {
    const targets = new Set(edges.map((e) => e.target));
    const roots = nodes.filter((n) => !targets.has(n.id));
    if (roots.length > 0) {
      const contextRoot = roots.find((n) => n.type === 'contextNode');
      const messageRoot = roots.find((n) => n.type === 'messageNode');
      return contextRoot ?? messageRoot ?? roots[0];
    }
    return (
      nodes.find((n) => n.type === 'contextNode') ??
      nodes.find((n) => n.type === 'messageNode') ??
      nodes[0]
    );
  }

  private getNextNode(
    nodes: FlowGraphNode[],
    edges: FlowGraphEdge[],
    fromId: string,
    sourceHandle?: string,
  ): FlowGraphNode | undefined {
    const edge = edges.find(
      (e) =>
        e.source === fromId &&
        (sourceHandle === undefined || (e.sourceHandle ?? 'true') === sourceHandle),
    );
    if (!edge) return undefined;
    return nodes.find((n) => n.id === edge.target);
  }

  private async evaluateCondition(
    node: FlowGraphNode,
    userText: string,
    flowName: string,
  ): Promise<boolean> {
    const conditionType = String(node.data?.conditionType ?? 'contains');
    const conditionValue = String(node.data?.conditionValue ?? '');
    return this.geminiService.evaluateCondition({
      conditionType,
      expectedValue: conditionValue,
      userMessage: userText,
      flowName,
    });
  }

  private extractFlowContext(flow: BotFlow): string {
    const nodes = this.parseJsonArray<FlowGraphNode>(flow.nodes);
    return nodes
      .filter((n) => n.type === 'contextNode')
      .map((n) => String(n.data?.context ?? '').trim())
      .filter(Boolean)
      .join('\n\n');
  }

  private buildFlowSystemPrompt(flow: BotFlow): string {
    const nodes = this.parseJsonArray<FlowGraphNode>(flow.nodes);
    const flowContext = this.extractFlowContext(flow);
    const stepHints = nodes
      .filter((n) => n.type === 'messageNode' && n.data?.useAi)
      .map((n) => String(n.data?.message ?? '').trim())
      .filter(Boolean);

    const base = `Você é o assistente virtual do bot "${flow.name}". Responda sempre em português do Brasil, de forma clara, cordial e concisa.`;

    const parts: string[] = [base];
    if (flowContext) {
      parts.push(`\nContextualização geral (siga rigorosamente):\n${flowContext}`);
    }
    if (stepHints.length > 0) {
      parts.push(`\nReferências adicionais do fluxo:\n${stepHints.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}`);
    }
    return parts.join('');
  }

  private async resolveMessageNode(
    node: FlowGraphNode,
    flow: BotFlow,
    userText: string,
    history: BotChatHistoryEntry[],
  ): Promise<string> {
    const template = String(node.data?.message ?? '').trim();
    const useAi = Boolean(node.data?.useAi);

    if (!template && !useAi) {
      return '';
    }

    if (useAi) {
      const instruction =
        template ||
        'Responda ao usuário com base no contexto do fluxo e na mensagem recebida.';
      const aiReply = await this.geminiService.generateReply({
        systemInstruction: this.buildFlowSystemPrompt(flow) + `\n\nInstrução desta etapa: ${instruction}`,
        userMessage: userText,
        history: history.slice(0, -1),
      });
      if (aiReply) return aiReply;
      return template || 'Não foi possível gerar resposta com IA no momento.';
    }

    return template;
  }

  private async generateFreeformReply(
    flow: BotFlow,
    userText: string,
    history: BotChatHistoryEntry[],
  ): Promise<string> {
    const configured = await this.geminiService.isConfigured();
    if (configured) {
      const aiReply = await this.geminiService.generateReply({
        systemInstruction: this.buildFlowSystemPrompt(flow),
        userMessage: userText,
        history: history.slice(0, -1),
      });
      if (aiReply) return aiReply;
    }

    return configured
      ? 'Não consegui processar sua mensagem agora. Tente novamente em instantes.'
      : 'Olá! Configure a chave Gemini em Admin → Configurações para ativar respostas com IA, ou monte um fluxo com nós de mensagem.';
  }
}
