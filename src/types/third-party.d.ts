declare module 'tmi.js' {
  export class Client {
    constructor(options?: any);
    connect(): Promise<[string, number]>;
    disconnect(): Promise<[string, number]>;
    getChannels(): string[];
    join(channel: string): Promise<[string, number]>;
    part(channel: string): Promise<[string, number]>;
    say(channel: string, message: string): Promise<[string, string]>;
    on(event: string, callback: (...args: any[]) => void): void;
  }

  export type ChatUserstate = any;
  export type SubMethods = any;
  export type SubUserstate = any;
  export type SubGiftUserstate = any;
}
