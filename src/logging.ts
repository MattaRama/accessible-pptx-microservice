import { LogLevel } from "./constants";
import type { AltTextJob } from "./service/alt-text-job";
import { supabase } from "./supabase";

export type JobStatTimestampType = 'start_time' | 'end_time' | 'created_time';

export async function logCreateJobStat(): Promise<string | undefined> {
  const id = (await supabase.from('jobstats').insert({
    created_time: new Date().toISOString(),
    source: 'pptx'
  }).select('id').single()).data?.id;

  return id;
}

export async function logUpdateJobStatTimestamp(
  job: AltTextJob,
  type: JobStatTimestampType
): Promise<void> {
  if (!job.supabaseId) {
    console.error(`logUpdateJobStatTimestamp: Job lacking supabase ID: job.id=${job.id}`);
    return;
  }

  await supabase.from('jobstats').update({
    [type]: new Date().toISOString(),
  } as Record<JobStatTimestampType, string>).eq('id', job.supabaseId);
}

export async function logJobFailed(
  job: AltTextJob,
) {
  if (!job.supabaseId) {
    console.error(`logJobFailed: Job lacking supabase ID: job.id=${job.id}`);
    return;
  }

  await supabase.from('jobstats').update({
    end_time: new Date().toISOString(),
    error: job.errorReason
  }).eq('id', job.supabaseId);
}

export type AIInteractionType = "describe" | "improve";

export async function logAIInteraction(
  job: AltTextJob,
  startTime: string,
  endTime: string,
  type: AIInteractionType,
  prompt?: string,
  inputTokens?: number,
  outputTokens?: number,
  totalTokens?: number,
  error?: string,
  output?: string,
) {
  if (job.loggingLevel < LogLevel.TRANSCRIPTION) {
    prompt = undefined;
    output = undefined;
  }

  const logObject = {
    jobstats_id: job.supabaseId,
    start_time: startTime,
    end_time: endTime,
    type,
    prompt,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    output,
    error,
    source: 'pptx'
  };

  await supabase.from('aiinteraction').insert(logObject);
}