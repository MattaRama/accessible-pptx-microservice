import express from 'express';
import type { Request, Response } from 'express';
import type { UploadedFile } from 'express-fileupload';
import { createJob, getJob } from './service/alt-text-service';
import { apiKeyAuth } from './auth';
import { DEFAULT_LOG_LEVEL, DOCX_MIME_TYPE, LogLevel } from './constants';
const { Router } = express;

const router = Router();

/**
 * Route: POST /alttext
 * Starts a new job
 */
router.post('/', apiKeyAuth, async (req: Request, res: Response) => {
  if (req.files && Object.keys(req.files).length === 1 && req.files.uploadedFile) {
    // check for valid file type
    const uploadedFile = <UploadedFile>(req.files.uploadedFile);
    if (uploadedFile.mimetype !== DOCX_MIME_TYPE) {
      res.status(401).send({
        reason: 'Invalid file type',
      });
      return;
    }

    const logLevel = req.body['logLevel'] || DEFAULT_LOG_LEVEL;

    if (logLevel > LogLevel.FULL || logLevel < 0) {
      res.status(400).send({
        reason: `Invalid logLevel parameter (must be ${LogLevel.LIMITED}-${LogLevel.FULL})`
      });
      return;
    }

    // start job
    let job;
    try {
      job = await createJob({file: uploadedFile, logLevel: logLevel});
    } catch (err) {
      res.status(500).send({
        reason: 'Internal server error.'
      });
      return;
    }

    // send job started response
    res.status(201).send({
      jobId: job.id
    });
  } else {
    res.status(400).send({
      reason: 'Invalid file count (must be exactly 1)'
    });
  }
});

/**
 * Route: GET /alttext
 * Gets job information
 */
router.get('/', apiKeyAuth, async (req: Request, res: Response) => {
  if (!req.body || !req.body.jobId) {
    res.status(400).send({
      reason: 'Invalid response body provided (requires jobId)'
    });
    return;
  }

  const job = getJob(req.body.jobId);

  if (!job) {
    res.status(400).send({
      reason: `Job with ID ${req.body.jobId} not found.`
    })
    return;
  }

  return res.status(200).send({
    jobId: job.id,
    jobStatus: job.status
  });
});

/**
 * Route: GET /alttext/fetch
 * Gets the resulting file from a job
 */
router.get('/fetch', apiKeyAuth, (req: Request, res: Response) => {
  if (!req.body || !req.body.jobId) {
    res.status(400).send({
      reason: 'Invalid response body provided (requires jobId)'
    });
    return;
  }

  const job = getJob(req.body.jobId);
  
  if (!job) {
    res.status(400).send({
      reason: `Job with ID ${req.body.jobId} not found.`
    })
    return;
  }

  if (job.status === 'COMPLETE') {
    const jobResult = { ...job.result };
    delete jobResult.mv;
    const data = jobResult.data;
    delete jobResult.data;

    res.status(200).send({
      ...jobResult,
      data: data?.toBase64()
    });
  } else if (job.status === 'FAILED') {
    res.status(500).send({
      status: 'FAILED',
      reason: job.errorReason,
      jobId: job.id
    });
  } else {
    res.status(400).send({
      reason: `Job with ID ${job.id} has status ${job.status}`
    });
  }
});

/**
 * Route: GET /alttext/subscribe
 * Gets the resulting file from a job once completed
 */
router.get('/subscribe', apiKeyAuth, (req: Request, res: Response) => {
  if (!req.body || !req.body.jobId) {
    res.status(400).send({
      reason: 'Invalid response body provided (requires jobId)'
    });
    return;
  }

  const job = getJob(req.body.jobId);
  
  if (!job) {
    res.status(400).send({
      reason: `Job with ID ${req.body.jobId} not found.`
    })
    return;
  }

  if (job.status === 'COMPLETE') {
    const jobResult = { ...job.result };
    delete jobResult.mv;
    const data = jobResult.data;
    delete jobResult.data;

    res.status(200).send({
      ...jobResult,
      data: data?.toBase64()
    });
  } else if (job.status === 'FAILED') {
    res.status(500).send({
      status: 'FAILED',
      reason: job.errorReason,
      jobId: job.id
    });
  } else {
    job.onComplete.push(async () => {
      switch (job.status) {
        case 'COMPLETE':
          const jobResult = { ...job.result };
          delete jobResult.mv;
          const data = jobResult.data;
          delete jobResult.data;

          res.status(200).send({
            ...jobResult,
            data: data?.toBase64()
          });
          break;
        case 'FAILED':
          res.status(500).send({
            status: 'FAILED',
            reason: job.errorReason,
            jobId: job.id
          });
          break;
        default:
          res.status(500).send({
            status: 'FAILED',
            reason: 'Internal server error',
            jobId: job.id
          });
      }
    });
  }
});

export default router;