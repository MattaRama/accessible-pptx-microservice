import type { UploadedFile } from "express-fileupload";
import type { AltTextJob } from "./alt-text-job";
import similarity from "compute-cosine-similarity";
import JSZip from "jszip";
import { applyAltTextToSlides, exportPptxContent } from "./pptx";
import { OpenAI } from "openai";
import { describeImagePrompt, improveImageDescriptionPrompt } from "./prompts";
import { logAIInteraction, verboseLog } from "../logging";

const ai = new OpenAI();

const DEFAULT_LLM_MODEL = process.env["DEFAULT_LLM_MODEL"] || "gpt-5.4-mini";
const DEFAULT_EMBEDDING_MODEL = process.env["DEFAULT_EMBEDDING_MODEL"] || "text-embedding-3-large";

async function improveImageDescription(base64Img: string, mimeType: string, job: AltTextJob, initDesc: string, context: string[], slideText: string) {
  const prompt = improveImageDescriptionPrompt(initDesc, context, base64Img, mimeType, slideText);

  const startTime = new Date().toISOString();

  const response = await ai.responses.create({
    model: DEFAULT_LLM_MODEL,
    input: prompt
  });

  const endTime = new Date().toISOString();

  logAIInteraction(
    job,
    startTime,
    endTime,
    'improve',
    JSON.stringify(prompt),
    response.usage?.input_tokens,
    response.usage?.output_tokens,
    response.usage?.total_tokens,
    response.error?.message,
    response.output_text,
  );

  return response.output_text;
}

async function describeImage(base64Img: string, mimeType: string, job: AltTextJob) {
  const prompt = describeImagePrompt(base64Img, mimeType);

  const startTime = new Date().toISOString();

  const response = await ai.responses.create({
    model: DEFAULT_LLM_MODEL,
    input: prompt
  });

  const endTime = new Date().toISOString();

  logAIInteraction(
    job,
    startTime,
    endTime,
    'describe',
    JSON.stringify(prompt),
    response.usage?.input_tokens,
    response.usage?.output_tokens,
    response.usage?.total_tokens,
    response.error?.message,
    response.output_text,
  );

  return response.output_text;
}

export async function processFile(job: AltTextJob): Promise<UploadedFile | null> {
  // export data from pptx
  const zip = await JSZip.loadAsync(job.file.data);
  const slideData = await exportPptxContent(zip);
  verboseLog(`[Generator] Slide data extracted (${job.id})`);
  
  // embed each slide's text
  const slideText = slideData.map(e => `[${e.texts.join('.\t')}]`);
  
  const textEmbeddings = (await ai.embeddings.create({
    model: DEFAULT_EMBEDDING_MODEL,
    input: slideText
  })).data.map(e => e.embedding);
  verboseLog(`[Generator] Embeddings generated (${job.id})`);
  
  // for each image, generate initial descriptions and embed
  const imgDescs = await Promise.all(slideData.map(async slide => {
    const descriptions = await Promise.all(slide.images.map(img => describeImage(img.base64, img.mimeType, job)));
    
    const imgEmbeds = (await ai.embeddings.create({
      model: DEFAULT_EMBEDDING_MODEL,
      input: slideText
    })).data.map(e => e.embedding);
    
    return descriptions.map((val, i) => ({
      text: val,
      embedding: imgEmbeds[i]
    }));
  }));
  verboseLog(`[Generator] Descriptions created and embeded (${job.id})`);
  
  // for each image:
  await Promise.all(slideData.map(async (slide, i) => {
    await Promise.all(slide.images.map(async (img, j) => {
      // vector search for context
      const similarities = textEmbeddings.map(text => ({
        similarity: similarity(imgDescs[i]![j]!.embedding!, text) || -1,
        text: slideText[i]
      })).sort((a, b) => (b.similarity - a.similarity));

      // refine image description
      const newDesc = await improveImageDescription(
        img.base64,
        img.mimeType,
        job,
        imgDescs[i]![j]!.text,
        similarities.slice(0, 3).map(e => e.text!),
        `[ ${slideData[i]!.texts.join('", "')} ]`
      );
      
      // modify original slideData
      slideData[i]!.images[j]!.altText = newDesc;
    }));
  }));
  
  verboseLog(`[Generator] Refined descriptions generated (${job.id})`);
  
  // add alt text to original pptx
  const newZip = await applyAltTextToSlides(zip, slideData);
  verboseLog(`[Generator] Alt text applied (${job.id})`);
  
  // return new pptx
  const newData = await newZip.generateAsync({ type: 'nodebuffer' });
  const ret = { ...job.file };
  ret.data = newData;
  verboseLog(`[Generator] Complete (${job.id})`);
  return ret;
}