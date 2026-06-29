import type { UploadedFile } from "express-fileupload";
import type { LogLevel } from "../constants";

export type AltTextJobStatus = "PENDING" | "RUNNING" | "FAILED" | "COMPLETE";

export type CompletionCallback = () => Promise<void>;

export interface AltTextJob {
  id: string;
  file: UploadedFile;
  result: UploadedFile | null;
  status: AltTextJobStatus;
  errorReason?: string;
  supabaseId?: string;
  onComplete: CompletionCallback[];
  loggingLevel: LogLevel;
};

export interface StartAltTextJobOptions {
  file: UploadedFile;
  logLevel?: LogLevel;
}