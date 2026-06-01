export const BOT_FLOW_CHANNELS = [
  'whatsapp_qr',
  'whatsapp_api',
  'instagram_direct',
  'telegram',
] as const;

export type BotFlowChannel = (typeof BOT_FLOW_CHANNELS)[number];

export function isBotFlowChannel(value: string): value is BotFlowChannel {
  return (BOT_FLOW_CHANNELS as readonly string[]).includes(value);
}
