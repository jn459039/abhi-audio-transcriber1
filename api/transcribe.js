import OpenAI, { toFile } from "openai";
import { get } from "@vercel/blob";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({
      error: "Groq API key is not configured."
    });
  }

  try {
    const { url, filename } = req.body || {};

    if (!url || !filename) {
      return res.status(400).json({
        error: "Missing audio file information."
      });
    }

    const blob = await get(url, {
      access: "private"
    });

    if (!blob || blob.statusCode !== 200) {
      return res.status(404).json({
        error: "Audio file not found in storage."
      });
    }

    const audioBuffer = await new Response(
      blob.stream
    ).arrayBuffer();

    const audioFile = await toFile(
      audioBuffer,
      filename,
      {
        type: blob.blob.contentType || "audio/mpeg"
      }
    );

    const client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1"
    });

    const result = await client.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-large-v3-turbo"
    });

    return res.status(200).json({
      text: result.text
    });

  } catch (error) {
    console.error("Transcription error:", error);

    return res.status(500).json({
      error: error.message || "Transcription failed."
    });
  }
}
