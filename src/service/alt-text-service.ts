import PQueue from 'p-queue';
import { type AltTextJob, type StartAltTextJobOptions } from './alt-text-job';
import { v4 as genId } from 'uuid';

import { processFile } from './alt-text-generator';
import { logCreateJobStat, logJobFailed, logUpdateJobStatTimestamp, verboseLog } from '../logging';
import { DEFAULT_LOG_LEVEL } from '../constants';

const CONCURRENCY_LIMIT = parseInt(process.env['JOB_CONCURRENCY_LIMIT'] || '10');
const JOB_HOLD_TIME = parseInt(process.env['JOB_HOLD_TIME_SECS'] || '900');

const jobQueue = new PQueue({ concurrency: CONCURRENCY_LIMIT });
const jobInfo: { [dict_key: string]: AltTextJob } = {};

export function getJob(id: string): AltTextJob | null {
  return jobInfo[id] || null;
}

export async function createJob(options: StartAltTextJobOptions) {
  // job id for logging
  const id = await logCreateJobStat();

  const job: AltTextJob = {
    id: genId(),
    supabaseId: id,
    file: options.file,
    status: 'PENDING',
    result: null,
    onComplete: [],
    loggingLevel: options.logLevel || DEFAULT_LOG_LEVEL
  };

  jobInfo[job.id] = job;

  jobQueue.add(() => processJob(job));

  return job;
}

export async function processJob(job: AltTextJob) {
  verboseLog(`[Service] Started ${job.id} (${job.supabaseId})`);
  job.status = "RUNNING";
  
  logUpdateJobStatTimestamp(job, 'start_time');
  
  try {
    const response = await processFile(job);
    job.result = response;
    job.status = 'COMPLETE';
    logUpdateJobStatTimestamp(job, 'end_time');
    verboseLog(`[Service] Completed ${job.id} (${job.supabaseId})`);
  } catch (err) {
    job.status = 'FAILED';
    job.errorReason = <string>err;
    logJobFailed(job);
    verboseLog(`[Service] Failed ${job.id} (${job.supabaseId})`);
  }

  // remove data from memory after JOB_HOLD_TIME seconds
  setTimeout(() => {
    delete jobInfo[job.id];
  }, JOB_HOLD_TIME * 1000)

  // job completion callbacks (for subscribe endpoint)
  job.onComplete.forEach(async (callback) => {
    await callback();
  });
}
