import OpenAI, { toFile } from "openai";
import { get } from "@vercel/blob";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function compressAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, [
      "-y",
      "-i", inputPath,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-b:a", "32k",
      "-f", "mp3",
      outputPath
    ]);

    let errorOutput = "";

    ffmpeg.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on("error", reject);

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error("Audio compression failed: " + errorOutput)
        );
      }
    });
  });
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

  if (!ffmpegPath) {
    return res.status(500).json({
      error: "FFmpeg is not available."
    });
  }

  let tempDir;

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

    const audioBuffer = Buffer.from(
      await new Response(blob.stream).arrayBuffer()
    );

    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "audio-transcriber-")
    );

    const inputPath = path.join(tempDir, "input-audio");
    const outputPath = path.join(tempDir, "compressed.mp3");

    await fs.writeFile(inputPath, audioBuffer);

    console.log(
      "Original audio size:",
      (audioBuffer.length / 1024 / 1024).toFixed(2),
      "MB"
    );

    await compressAudio(inputPath, outputPath);

    const compressedBuffer = await fs.readFile(outputPath);

    console.log(
      "Compressed audio size:",
      (compressedBuffer.length / 1024 / 1024).toFixed(2),
      "MB"
    );

    if (compressedBuffer.length > 24 * 1024 * 1024) {
      return res.status(413).json({
        error: "Audio is still too large after compression. Please use a shorter recording."
      });
    }

    const audioFile = await toFile(
      compressedBuffer,
      "compressed.mp3",
      {
        type: "audio/mpeg"
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

  } finally {
    if (tempDir) {
      await fs.rm(tempDir, {
        recursive: true,
        force: true
      }).catch(console.error);
    }
  }
}
