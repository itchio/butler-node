import { Socket, createConnection } from "net";
import * as split2 from "split2";

var debug = require("debug")("buse:client");

export enum StandardErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
}

export type IRequestCreator<T, U> = (
  params: T,
) => (client: Client) => IRequest<T, U>;
export type INotificationCreator<T> = (params: T) => INotification<T>;

export type IResultCreator<T> = (
  id: number | null,
  result?: T,
  error?: RpcError,
) => IResult<T>;

export enum RequestType {
  Request = 0,
  Notification = 1,
}

export const createNotification = <T>(
  method: string,
  requestType = RequestType.Request,
): INotificationCreator<T> => (params: T) => ({
  jsonrpc: "2.0",
  method,
  params,
});

export const createRequest = <T, U>(
  method: string,
  requestType = RequestType.Request,
): IRequestCreator<T, U> => (params: T) => (client: Client) => ({
  jsonrpc: "2.0",
  method,
  id: client.generateID(),
  params,
});

export const createResult = <T>(): IResultCreator<T> => (
  id: number | null,
  result?: T,
  error?: RpcError,
) => {
  if (error) {
    return {
      jsonrpc: "2.0",
      error,
      id,
    };
  } else {
    return {
      jsonrpc: "2.0",
      result,
      id,
    };
  }
};

export const genericResult = createResult<void>();

export interface INotification<T> {
  method: string;
  params?: T;
}

export interface IRequest<T, U> extends INotification<T> {
  id: number;
}

export interface IResult<T> {
  id: number | null;
  result?: T;
  error?: RpcError;
}

export interface RpcError {
  code: number;
  message: string;
  data?: any;
}

interface IResultPromises {
  [key: number]: {
    resolve: (payload: any) => void;
    reject: (e: Error) => void;
  };
}

export type IRequestHandler<T, U> = (payload: IRequest<T, U>) => U | Promise<U>;

interface IRequestHandlers {
  [method: string]: IRequestHandler<any, any>;
}

export type INotificationHandler<T> = (payload: INotification<T>) => any;

interface INotificationHandlers {
  [method: string]: INotificationHandler<any>;
}

export type IErrorHandler = (e: RpcError) => void;

export class Client {
  socket: Socket;
  private resultPromises: IResultPromises = {};
  private requestHandlers: IRequestHandlers = {};
  private notificationHandlers: INotificationHandlers = {};
  private errorHandler: IErrorHandler = null;
  idSeed = 1;

  constructor() {}

  generateID(): number {
    return this.idSeed++;
  }

  async connect(address: string) {
    if (this.socket) {
      throw new Error("json-rpc client already connected!");
    }

    return new Promise((resolve, reject) => {
      debug(`connecting to butler service on ${address}`);
      const [host, port] = address.split(":");
      const socket = createConnection(+port, host);

      socket.on("connect", () => {
        debug(`connected to butler service!`);
        this.socket = socket;
        socket.pipe(split2()).on("data", (line: string) => {
          this.onReceiveRaw(line);
        });
        resolve();
      });

      socket.on("error", e => {
        if (!this.socket) {
          // ignore errors, we've closed
          return;
        }
        console.warn(`json-rpc socket error: ${e.message}`);
        this.socket = null;
      });

      socket.on("close", () => {
        if (!this.socket) {
          // ignore errors, we've closed
          return;
        }
        console.warn(`json-rpc socket closed`);
        this.socket = null;
      });
    });
  }

  close() {
    if (this.socket) {
      const { socket } = this;
      this.socket = null;
      socket.end();
    }
  }

  onError(handler: IErrorHandler) {
    this.errorHandler = handler;
  }

  onRequest<T, U>(rc: IRequestCreator<T, U>, handler: IRequestHandler<T, U>) {
    const sample = rc(null)(this);
    const { method } = sample;

    if (this.requestHandlers[method]) {
      throw new Error(`cannot register a second request handler for ${method}`);
    }
    this.requestHandlers[method] = handler;
  }

  onNotification<T>(
    nc: INotificationCreator<T>,
    handler: INotificationHandler<T>,
  ) {
    const example = nc(null);
    const { method } = example;

    if (this.notificationHandlers[method]) {
      throw new Error(
        `cannot register a second notification handler for ${method}`,
      );
    }
    this.notificationHandlers[method] = handler;
  }

  notify<T>(nc: INotificationCreator<T>, params?: T) {
    const obj = nc(params);
  }

  async call<T, U>(
    creator: (c: Client) => IRequest<T, U>,
  ): Promise<IResult<U>> {
    const obj = creator(this);

    if (!obj.id) {
      throw new Error(`missing id in request ${JSON.stringify(obj)}`);
    }

    this.sendRaw(obj);

    return new Promise<IResult<U>>((resolve, reject) => {
      this.resultPromises[obj.id] = { resolve, reject };
    });
  }

  sendResult<T>(
    rc: IResultCreator<T>,
    id: number,
    result?: T,
    error?: RpcError,
  ): void {
    const obj = rc(id, result, error);
    if (!obj.id) {
      throw new Error(`missing id in result ${JSON.stringify(obj)}`);
    }

    this.sendRaw(obj);
  }

  private sendRaw(obj: any) {
    if (!this.socket) {
      throw new Error(`trying to send on disconnected client`);
    }

    const type = typeof obj;
    if (type !== "object") {
      throw new Error(
        `can only send object via json-rpc, refusing to send ${type}`,
      );
    }

    if (obj.jsonrpc != "2.0") {
      throw new Error(
        `expected message.jsonrpc == '2.0', got ${JSON.stringify(obj.jsonrpc)}`,
      );
    }

    const payload = JSON.stringify(obj);
    this.socket.write(payload + "\n");
  }

  private onReceiveRaw(line: string) {
    let obj: any;

    try {
      obj = JSON.parse(line);
    } catch (e) {
      this.sendResult(genericResult, null, null, <RpcError>{
        code: StandardErrorCode.ParseError,
        message: e.message,
      });
      return;
    }

    if (typeof obj !== "object") {
      this.sendResult(genericResult, null, null, <RpcError>{
        code: StandardErrorCode.InvalidRequest,
        message: `expected object, got ${typeof obj}`,
      });
      return;
    }

    if (obj.jsonrpc != "2.0") {
      this.sendResult(genericResult, null, null, <RpcError>{
        code: StandardErrorCode.InvalidRequest,
        message: `expected jsonrpc = '2.0', got ${JSON.stringify(obj.jsonrpc)}`,
      });
      return;
    }

    if (!obj.id) {
      // we got a notification!
      const handler = this.notificationHandlers[obj.method];
      if (!handler) {
        console.warn(`no handler for notification ${JSON.stringify(obj)}`);
        return;
      }

      handler(obj);
      return;
    }

    if (obj.method) {
      const handler = this.requestHandlers[obj.method];
      if (!handler) {
        this.sendResult(genericResult, obj.id, null, <RpcError>{
          code: StandardErrorCode.MethodNotFound,
          message: `no handler is registered for method ${obj.method}`,
        });
        return;
      }

      let retval: any;
      try {
        retval = handler(obj);
      } catch (e) {
        this.sendResult(genericResult, obj.id, null, <RpcError>{
          code: StandardErrorCode.InternalError,
          message: `sync error: ${e.message}`,
          data: {
            stack: e.stack,
          },
        });
        return;
      }

      Promise.resolve(retval)
        .then(result => {
          this.sendResult(genericResult, obj.id, result, null);
        })
        .catch(e => {
          this.sendResult(genericResult, obj.id, null, <RpcError>{
            code: StandardErrorCode.InternalError,
            message: `async error: ${e.message}`,
            data: {
              stack: e.stack,
            },
          });
        });
      return;
    }

    if (obj.result) {
      const promise = this.resultPromises[obj.id];
      if (!promise) {
        console.warn(`dropped result: ${JSON.stringify(obj.result)}`);
        return;
      }

      promise.resolve(obj.result);
      delete this.resultPromises[obj.id];
      return;
    }

    if (obj.error) {
      const promise = this.resultPromises[obj.id];
      if (!promise) {
        console.warn(`dropped error: ${JSON.stringify(obj.result)}`);
        return;
      }

      promise.reject(obj.result);
      delete this.resultPromises[obj.id];
      return;
    }

    this.sendResult(genericResult, obj.id, null, <RpcError>{
      code: StandardErrorCode.InvalidRequest,
      message: "has id but doesn't have method, result, or error",
    });
  }
}