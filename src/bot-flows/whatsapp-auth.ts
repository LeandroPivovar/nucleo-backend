import {
  AuthenticationCreds,
  AuthenticationState,
  BufferJSON,
  initAuthCreds,
  SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import { Repository } from 'typeorm';
import { BotWhatsappSession } from '../entities/bot-whatsapp-session.entity';

/**
 * Creates an authentication state backed by TypeORM.
 * We store sessions by prefixing the keys with the flowId (e.g., "123_creds", "123_app-state-sync-key_...").
 */
export const useTypeORMAuthState = async (
  botFlowId: number,
  sessionRepository: Repository<BotWhatsappSession>,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> => {
  const writeData = async (data: any, key: string) => {
    const sessionData = JSON.stringify(data, BufferJSON.replacer);
    const sessionId = `${botFlowId}_${key}`;

    let session = await sessionRepository.findOne({ where: { sessionId } });
    if (!session) {
      session = sessionRepository.create({ sessionId, sessionData });
    } else {
      session.sessionData = sessionData;
    }
    await sessionRepository.save(session);
  };

  const readData = async (key: string) => {
    try {
      const sessionId = `${botFlowId}_${key}`;
      const session = await sessionRepository.findOne({ where: { sessionId } });
      if (session) {
        return JSON.parse(session.sessionData, BufferJSON.reviver);
      }
      return null;
    } catch (error) {
      return null;
    }
  };

  const removeData = async (key: string) => {
    try {
      const sessionId = `${botFlowId}_${key}`;
      await sessionRepository.delete({ sessionId });
    } catch (error) {}
  };

  const creds: AuthenticationCreds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [_: string]: SignalDataTypeMap[typeof type] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = Buffer.from(value.data, 'base64'); // Baileys specific conversion if needed, wait, BufferJSON handles buffers!
              }
              data[id] = value;
            }),
          );
          return data;
        },
        set: async (data) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            for (const id in data[category as keyof typeof data]) {
              const value = data[category as keyof typeof data]?.[id];
              const key = `${category}-${id}`;
              if (value) {
                tasks.push(writeData(value, key));
              } else {
                tasks.push(removeData(key));
              }
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData(creds, 'creds'),
  };
};
