import { IPCMessage, MessageHandler } from "./types";

export class MessageBus {
  private channels: Map<string, Set<MessageHandler>> = new Map();

  subscribe(channel: string, handler: MessageHandler): () => void {
    if (!this.channels.has(channel)) this.channels.set(channel, new Set());
    this.channels.get(channel)!.add(handler);

    return () => this.unsubscribe(channel, handler);
  }

  unsubscribe(channel: string, handler: MessageHandler) {
    const set = this.channels.get(channel);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this.channels.delete(channel);
  }

  publish(channel: string, msg: IPCMessage) {
    const set = this.channels.get(channel);
    if (!set) return;
    for (const h of Array.from(set)) {
      try {
        void h(msg);
      } catch (err) {
        // swallow handler errors to avoid breaking publisher
        console.error("MessageBus handler error:", err);
      }
    }
  }

  once(channel: string, handler: MessageHandler): () => void {
    const wrapper: MessageHandler = (msg) => {
      try {
        void handler(msg);
      } finally {
        this.unsubscribe(channel, wrapper);
      }
    };
    return this.subscribe(channel, wrapper);
  }
}
