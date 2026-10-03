import OpenAI, { toFile } from "openai";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

const MAX_CHUNK_SIZE = 20 * 1024 * 1024;
const CHUNK_DURATION = 300;

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath, args);

    let stderr = "";

    process.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    process.on("error", reject);

    process.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error("FFmpeg failed: " + stderr.slice(-2000))
        );
      }
    });
  });
}

async function transcribeFile(client, filePath, filename) {
  const buffer = await fs.readFile(filePath);

  const audioFile = await toFile(
    buffer,
    filename,
    { type: "audio/mpeg" }
  );

  const result = await client.audio.transcriptions.create({
    file: audioFile,
    model: "whisper-large-v3-turbo"
  });

  return result.text || "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "POST only"
    });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({
      error: "Groq API key is not configured."
    });
  }

  let tempDir;

  try {
    const { url } = req.body || {};

    if (!url) {
      return res.status(400).json({
        error: "Audio URL is required."
      });
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({
        error: "Invalid audio URL."
      });
    }

    if (parsedUrl.protocol !== "https:") {
      return res.status(400).json({
        error: "Only HTTPS audio links are supported."
      });
    }

    if (!ffmpegPath) {
      throw new Error("FFmpeg is not installed.");
    }

    const client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1"
    });

    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "audio-audit-")
    );

    const inputPath = path.join(tempDir, "original-audio");

    const outputPattern = path.join(
      tempDir,
      "chunk-%03d.mp3"
    );

    // Download audio
    const audioResponse = await fetch(url, {
      signal: AbortSignal.timeout(120000)
    });

    if (!audioResponse.ok) {
      return res.status(400).json({
        error: "Could not download audio from the supplied link."
      });
    }

    const contentType =
      audioResponse.headers.get("content-type") || "";

    if (
      contentType &&
      !contentType.startsWith("audio/") &&
      !contentType.startsWith("video/") &&
      !contentType.includes("octet-stream")
    ) {
      return res.status(400).json({
        error: "The URL does not appear to point directly to an audio file."
      });
    }

    const audioBuffer = Buffer.from(
      await audioResponse.arrayBuffer()
    );

    if (audioBuffer.length === 0) {
      return res.status(400).json({
        error: "The audio file is empty."
      });
    }

    await fs.writeFile(inputPath, audioBuffer);

    // Split and compress audio into 5-minute MP3 chunks
    await runFFmpeg([
      "-y",
      "-i", inputPath,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-b:a", "48k",
      "-f", "segment",
      "-segment_time", String(CHUNK_DURATION),
      "-reset_timestamps", "1",
      outputPattern
    ]);

    const files = (await fs.readdir(tempDir))
      .filter((name) => /^chunk-\d+\.mp3$/.test(name))
      .sort();

    if (files.length === 0) {
      throw new Error("No audio chunks were generated.");
    }

    const transcripts = [];

    // Transcribe each chunk
    for (let i = 0; i < files.length; i++) {
      const chunkPath = path.join(tempDir, files[i]);

      const stats = await fs.stat(chunkPath);

      if (stats.size > MAX_CHUNK_SIZE) {
        throw new Error(
          `Audio chunk ${i + 1} exceeds the safe size limit.`
        );
      }

      const text = await transcribeFile(
        client,
        chunkPath,
        files[i]
      );

      if (text.trim()) {
        transcripts.push(text.trim());
      }
    }

    const transcript = transcripts.join("\n\n");

    if (!transcript.trim()) {
      return res.status(422).json({
        error: "No speech could be detected."
      });
    }

    // Generate call audit
    const auditResponse =
      await client.chat.completions.create({
        model: "openai/gpt-oss-120b",
        temperature: 0.2,
        response_format: {
          type: "json_object"
        },
        messages: [
          {
            role: "system",
            content: `
You are an expert airline customer service call auditor.

Analyze the supplied call transcript and produce
a factual, concise audit report.

Do not invent information.
If information is missing, write "Not specified".

Identify the airline only when supported by the conversation.
Distinguish the customer's request from the agent's response.
Clearly state whether the issue was resolved.

Return valid JSON with exactly these fields:

{
  "airline": "",
  "customer_intent": "",
  "call_summary": "",
  "agent_response": "",
  "resolution": "",
  "pending_action": "",
  "call_outcome": ""
}

For call_outcome, use only:
Resolved, Partially Resolved, Unresolved,
or Unable to Determine.

Write the report in clear professional English.
`
          },
          {
            role: "user",
            content: `
Analyze this airline customer service call.

TRANSCRIPT:
${transcript}
`
          }
        ]
      });

    let audit;

    try {
      audit = JSON.parse(
        auditResponse.choices[0]?.message?.content || "{}"
      );
    } catch (error) {
      console.error("Audit parsing error:", error);

      audit = {
        airline: "Not specified",
        customer_intent: "Unable to generate",
        call_summary: "Audit generation failed.",
        agent_response: "Unable to determine",
        resolution: "Unable to determine",
        pending_action: "Not specified",
        call_outcome: "Unable to Determine"
      };
    }

    return res.status(200).json({
      success: true,
      filename:
        parsedUrl.pathname.split("/").pop() || "audio.mp3",
      chunks_processed: files.length,
      text: transcript,
      audit
    });

  } catch (error) {
    console.error("Direct link processing error:", error);

    return res.status(500).json({
      error: error.message || "Audio processing failed."
    });

  } finally {
    if (tempDir) {
      await fs.rm(tempDir, {
        recursive: true,
        force: true
      }).catch(console.error);
    }
  }
}
