import type OpenAI from "openai";

export function describeImagePrompt(
  base64Image: string,
  mimeType: string = "image/png",
): OpenAI.Responses.ResponseInput {
  const dataUri = `data:${mimeType};base64,${base64Image}`;

  return [
    {
      role: "system",
      content:
        "You are an expert in digital accessibility and WCAG 2.2 guidelines. The user will provide an image. You are to describe this image in great detail, providing no added commentary- just a perfect description of the image. Consider how you would describe the image to someone who is blind or low-vision. Include only information relevant to the image.",
    },
    {
      role: "user",
      content: [{ type: "input_image", image_url: dataUri, detail: "auto" }],
    },
  ];
}

export function improveImageDescriptionPrompt(
  baseDesc: string,
  context: string[],
  base64Image: string,
  mimeType: string,
  slideText: string
): OpenAI.Responses.ResponseInput {
  const dataUri = `data:${mimeType};base64,${base64Image}`;

  return [
    {
      role: "system",
      content: `You are an expert in digital accessibility and WCAG 2.2 guidelines.
The user will provide a BASE_DESCRIPTION, CONTEXT, SLIDE_TEXT, and an image.
BASE_DESCRIPTION is an AI-generated description of the image.
CONTEXT is some possibly useful context involving the image.
SLIDE_TEXT is all the text contained on the slide the image is from.
You are to determine if the CONTEXT is relevant to the BASE_DESCRIPTION, and include it in the description naturally if it is relevant. If it is not relevant, don't include anything about it.
Do not provide any additional commentary. Only include relevant information.
When writing the updated description, consider how you would write it for someone who is blind or low-vision.`,
    },
    { role: "user", content: `BASE_DESCRIPTION:\n\n\n${baseDesc}\n\n\n` },
    { role: "user", content: `CONTEXT:\n\n\n${context.join("\n\n\n")}` },
    { role: "user", content: `SLIDE_TEXT:\n\n\n${slideText}\n\n\n` },
    {
      role: "user",
      content: [{ type: "input_image", image_url: dataUri, detail: "auto" }],
    },
  ];
}
