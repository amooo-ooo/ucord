import fetch from 'node-fetch';
import type { Tool } from '../../types';
import { MessageAttachment } from 'discord.js-selfbot-v13';

export const tool: Tool = {
    name: "generate_image",
    description: "Generate an AI image from a text prompt and send it to Discord. Be extremely detailed, use concise, vivid keywords and modifiers, and list features separated by commas. Names of public figures are filtered; describe their features instead.",
    parameters: {
        type: "object",
        properties: {
            prompt: { type: "string", description: "The text description of the image to generate" },
            mode: { 
                type: "string", 
                description: "The generation mode",
                enum: ["base", "creative"],
                default: "base"
            },
            width: { 
                type: "number", 
                description: "Image width in pixels",
                default: 1024
            },
            height: { 
                type: "number", 
                description: "Image height in pixels",
                default: 1024
            },
            seed: { 
                type: "number", 
                description: "Random seed for generation (0 for random)",
                default: 0
            },
            cfg_scale: { 
                type: "number", 
                description: "How closely the image follows the prompt (1-10)",
                default: 3.5
            },
            steps: { 
                type: "number", 
                description: "Number of diffusion steps (more = higher quality but slower)",
                default: 50
            }
        },
        required: ["prompt"],
    },
    handler: async (args: Record<string, any>, message?: any): Promise<string> => {
        let { 
            prompt,
            mode = "base",
            width = 1024,
            height = 1024,
            seed = 0,
            cfg_scale = 3.5,
            steps = 50
        } = args;
        
        if (!message) {
            return "Error: Message context not provided. Cannot send image.";
        }

        const validModes = ["base", "creative"];
        if (!validModes.includes(mode)) {
            console.warn(`Invalid mode "${mode}" received. Falling back to "base".`);
            mode = "base";
        }

        try {
            const invokeUrl = "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev";
            
            const headers = {
                "Authorization": `Bearer ${process.env.NVIDIA_API_KEY}`,
                "Accept": "application/json"
            };
            
            const payload = {
                prompt,
                mode,
                cfg_scale,
                width,
                height,
                seed,
                steps
            };

            if (message.channel) {
                await message.channel.sendTyping();
            }

            const response = await fetch(invokeUrl, {
                method: "post",
                body: JSON.stringify(payload),
                headers: { "Content-Type": "application/json", ...headers }
            });

            if (response.status != 200) {
                const errBody = await (await response.blob()).text();
                throw new Error(`Invocation failed with status ${response.status}: ${errBody}`);
            }
            
            const responseData: any = await response.json();
            console.log("API Response:", JSON.stringify(responseData).substring(0, 200) + "...");
            
            let imageData: string | undefined;
            
            if (responseData?.artifacts && Array.isArray(responseData.artifacts) && responseData.artifacts.length > 0) {
                const firstArtifact = responseData.artifacts[0];
                if (firstArtifact.base64) {
                    imageData = firstArtifact.base64;
                }
            }
            
            if (!imageData) {
                const structure = typeof responseData === 'object' && responseData !== null 
                    ? Object.keys(responseData).join(', ') 
                    : typeof responseData;
                throw new Error(`No image data in response. Response structure: ${structure}`);
            }
            
            const imageBuffer = Buffer.from(imageData, 'base64');
            
            const attachment = new MessageAttachment(imageBuffer, 'generated-image.png');
            
            await message.channel.send({
                files: [attachment]
            });

            return `Image successfully generated and sent for prompt: "${prompt}"`;
        } catch (error) {
            if (error instanceof Error) {
                return `Failed to generate image: ${error.message}`;
            }
            return `Failed to generate image: Unknown error`;
        }
    }
};

export default tool;
