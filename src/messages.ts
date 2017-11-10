import {
  createRequest,
  Client,
  IRequest,
  INotification,
  createNotification,
} from "./client";
import * as itchio from "ts-itchio-api";

export interface OperationStartParams {
  stagingFolder: string;
  operation: "install";
  installParams?: InstallParams;
}

export interface InstallParams {
  game: itchio.Game;
  installFolder: string;
  upload?: itchio.Upload;
  build?: itchio.Build;
  credentials: GameCredentials;
}

export interface GameCredentials {
  server?: string;
  apiKey: string;
  downloadKey?: number;
}

export interface PickUploadParams {
  uploads: itchio.Upload[];
}

export interface PickUploadResult {
  index: number;
}

export interface OperationProgressNotification {
  progress: number;
  eta?: number;
  bps?: number;
}

export interface OperationResult {
  success: boolean;
  errorMessage?: string;
  errorStack?: string;

  installResult?: InstallResult;
}

export interface InstallResult {
  game: itchio.Game;
  upload: itchio.Upload;
  build?: itchio.Build;
}

export const Version = {
  Get: createRequest<
    {},
    {
      version: string;
      versionString: string;
    }
  >("Version.Get"),
};

export const Operation = {
  Start: createRequest<OperationStartParams, OperationResult>(
    "Operation.Start",
  ),
  Progress: createNotification<OperationProgressNotification>(
    "Operation.Progress",
  ),
};

export const Log = createNotification<{
  level: string;
  message: string;
}>("Log");

export interface DoublePayload {
  number: number;
}

export const Test = {
  DoubleTwiceRequest: createRequest<DoublePayload, DoublePayload>(
    "Test.DoubleTwice",
  ),
  DoubleRequest: createRequest<DoublePayload, DoublePayload>("Test.Double"),
};