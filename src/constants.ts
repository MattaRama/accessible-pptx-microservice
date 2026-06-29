export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export enum LogLevel {
  "LIMITED" = 0,
  "TRANSCRIPTION" = 1,
  "FULL" = 2,
}

export const DEFAULT_LOG_LEVEL = LogLevel.TRANSCRIPTION;
