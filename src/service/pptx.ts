import * as path from 'path';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export interface ExportedImage {
  filename: string;
  mimeType: string;
  base64: string;
  buffer: Buffer;
  dataUri: string;
  altText?: string;
}

export interface SlideData {
  slideNumber: number;
  slideFilename: string;
  texts: string[];
  images: ExportedImage[];
}

/**
 * Loads relationship mapping (rId -> Target) for a specific slide from its .rels file.
 * Returns an empty map if no relationships exist.
 */
async function loadSlideRelationships(
  zip: JSZip,
  slideFilename: string
): Promise<Map<string, string>> {
  const relsMap = new Map<string, string>();
  const slideDir = path.posix.dirname(slideFilename);
  const slideBase = path.posix.basename(slideFilename);
  const relsFilename = path.posix.join(slideDir, '_rels', `${slideBase}.rels`);

  const relsFile = zip.file(relsFilename);
  if (!relsFile) {
    return relsMap;
  }

  const parser = new DOMParser();
  const relsXmlText = await relsFile.async('string');
  const relsDoc = parser.parseFromString(relsXmlText, 'text/xml');
  const relationships = relsDoc.getElementsByTagName('Relationship');

  for (let i = 0; i < relationships.length; i++) {
    const rel = relationships[i];
    if (rel) {
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target');
      if (id && target) {
        relsMap.set(id, target);
      }
    }
  }

  return relsMap;
}

/**
 * Resolves a relationship ID to an image buffer and metadata from the JSZip archive.
 */
async function getImageFromRelId(
  zip: JSZip,
  slideFilename: string,
  rId: string,
  relsMap: Map<string, string>
): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> {
  const target = relsMap.get(rId);
  if (!target) return null;

  const slideDir = path.posix.dirname(slideFilename);
  // Resolve target path relative to the slide's directory inside the zip
  const imagePath = path.posix.normalize(path.posix.join(slideDir, target));
  const imageFile = zip.file(imagePath);
  if (!imageFile) return null;

  const buffer = await imageFile.async('nodebuffer');

  // Determine mime type from file extension
  const ext = path.posix.extname(imagePath).toLowerCase();
  let mimeType = 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
  else if (ext === '.gif') mimeType = 'image/gif';
  else if (ext === '.webp') mimeType = 'image/webp';
  else if (ext === '.svg') mimeType = 'image/svg+xml';
  else if (ext === '.tiff') mimeType = 'image/tiff';
  else if (ext === '.bmp') mimeType = 'image/bmp';

  return {
    buffer,
    mimeType,
    filename: path.posix.basename(imagePath),
  };
}

/**
 * Extracts all text and images from a PowerPoint presentation ZIP object, organized by slide.
 * 
 * @param zip The JSZip object loaded with the PPTX file data.
 * @returns A promise that resolves to an array of SlideData, sorted in numerical slide order.
 */
export async function exportPptxContent(zip: JSZip): Promise<SlideData[]> {
  const slidesData: SlideData[] = [];

  // Find all slide XML files in the presentation
  const slideFiles = Object.keys(zip.files)
    .filter(filename => filename.startsWith('ppt/slides/slide') && filename.endsWith('.xml'))
    .map(filename => {
      // Extract slide number from filename, e.g., ppt/slides/slide12.xml -> 12
      const match = filename.match(/ppt\/slides\/slide(\d+)\.xml/);
      const slideNumber = (match && match[1]) ? parseInt(match[1], 10) : 0;
      return { filename, slideNumber };
    })
    // Sort slides numerically to keep them in the correct presentation order
    .sort((a, b) => a.slideNumber - b.slideNumber);

  for (const slideFile of slideFiles) {
    const fileZipEntry = zip.file(slideFile.filename);
    if (!fileZipEntry) continue;

    const xmlText = await fileZipEntry.async('string');
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

    // 1. Extract relationships map for the current slide to resolve image targets
    const relsMap = await loadSlideRelationships(zip, slideFile.filename);

    // 2. Extract images
    const images: ExportedImage[] = [];
    const processedRIds = new Set<string>();
    const blipElements = xmlDoc.getElementsByTagName('a:blip');

    for (let i = 0; i < blipElements.length; i++) {
      const blip = blipElements[i];
      if (!blip) continue;

      const rId = blip.getAttribute('r:embed') || blip.getAttribute('r:link');
      if (!rId || processedRIds.has(rId)) continue;

      processedRIds.add(rId);

      const imageInfo = await getImageFromRelId(zip, slideFile.filename, rId, relsMap);
      if (imageInfo) {
        const base64Str = imageInfo.buffer.toString('base64');
        images.push({
          filename: imageInfo.filename,
          mimeType: imageInfo.mimeType,
          base64: base64Str,
          buffer: imageInfo.buffer,
          dataUri: `data:${imageInfo.mimeType};base64,${base64Str}`,
        });
      }
    }

    // 3. Extract text paragraphs
    const texts: string[] = [];
    const pElements = xmlDoc.getElementsByTagName('a:p');

    for (let i = 0; i < pElements.length; i++) {
      const p = pElements[i];
      if (!p) continue;

      const tElements = p.getElementsByTagName('a:t');
      let paragraphText = '';
      for (let j = 0; j < tElements.length; j++) {
        const t = tElements[j];
        if (t && t.textContent) {
          paragraphText += t.textContent;
        }
      }

      // Add non-empty paragraphs
      if (paragraphText.trim()) {
        texts.push(paragraphText);
      }
    }

    slidesData.push({
      slideNumber: slideFile.slideNumber,
      slideFilename: slideFile.filename,
      texts,
      images,
    });
  }

  return slidesData;
}

/**
 * Applies alt text from SlideData back into the PPTX zip by setting the 'descr'
 * attribute on each picture's <p:cNvPr> element.
 *
 * Images are matched by filename — each p:pic's embedded relationship ID is resolved
 * to an image file path, and its basename is compared against ExportedImage.filename.
 *
 * @param zip The JSZip object containing the PPTX file data.
 * @param slidesData The array of SlideData with alt text populated on each image.
 * @returns The modified JSZip object with alt text written into the slide XML.
 */
export async function applyAltTextToSlides(
  zip: JSZip,
  slidesData: SlideData[]
): Promise<JSZip> {
  const parser = new DOMParser();
  const serializer = new XMLSerializer();

  for (const slideData of slidesData) {
    const slideFilename = slideData.slideFilename;
    const fileZipEntry = zip.file(slideFilename);
    if (!fileZipEntry) continue;

    // Build a lookup map of filename -> altText from the slide's exported images
    const altTextByFilename = new Map<string, string>();
    for (const image of slideData.images) {
      if (image.altText) {
        altTextByFilename.set(image.filename, image.altText);
      }
    }

    // Skip this slide if none of its images have alt text to apply
    if (altTextByFilename.size === 0) continue;

    const xmlText = await fileZipEntry.async('string');
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

    // Load relationships for this slide to resolve rId -> image path
    const relsMap = await loadSlideRelationships(zip, slideFilename);

    const picElements = xmlDoc.getElementsByTagName('p:pic');
    let modified = false;

    for (let i = 0; i < picElements.length; i++) {
      const pic = picElements[i];
      if (!pic) continue;

      // Resolve the image filename from the blip's relationship ID
      const blipElements = pic.getElementsByTagName('a:blip');
      if (!blipElements || blipElements.length === 0) continue;

      const blip = blipElements[0];
      if (!blip) continue;

      const rId = blip.getAttribute('r:embed') || blip.getAttribute('r:link');
      if (!rId) continue;

      const target = relsMap.get(rId);
      if (!target) continue;

      const imageFilename = path.posix.basename(target);
      const altText = altTextByFilename.get(imageFilename);
      if (!altText) continue;

      // Find the <p:cNvPr> element and set the 'descr' attribute
      const cNvPrElements = pic.getElementsByTagName('p:cNvPr');
      if (!cNvPrElements || cNvPrElements.length === 0) continue;

      const cNvPr = cNvPrElements[0];
      if (!cNvPr) continue;

      cNvPr.setAttribute('descr', altText);
      modified = true;
    }

    // Only re-serialize and update the zip if changes were made
    if (modified) {
      const updatedXmlText = serializer.serializeToString(xmlDoc);
      zip.file(slideFilename, updatedXmlText);
    }
  }

  return zip;
}
