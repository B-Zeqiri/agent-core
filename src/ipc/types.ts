export type IPCMessage = {
  id: string;
  from: string;
  to?: string; // specific agent id
  tag?: string; // target tag
  type: string;
  payload: any;
  timestamp: number;
};

export type MessageHandler = (msg: IPCMessage) => Promise<void> | void;
