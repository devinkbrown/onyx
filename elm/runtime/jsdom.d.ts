declare module 'jsdom' {
  export interface ConstructorOptions {
    readonly url?: string | URL;
  }
  export class JSDOM {
    constructor(html?: string, options?: ConstructorOptions);
    readonly window: Window & typeof globalThis;
  }
}
