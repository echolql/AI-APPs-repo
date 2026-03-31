export function playPCM(base64Data: string, sampleRate: number = 24000) {
  if (!base64Data) {
    throw new Error("No audio data provided");
  }
  
  try {
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    // Convert Uint8Array (PCM 16-bit) to Float32Array
    const int16Array = new Int16Array(bytes.buffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768;
    }

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const buffer = audioCtx.createBuffer(1, float32Array.length, sampleRate);
    buffer.getChannelData(0).set(float32Array);

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start();
    
    return { audioCtx, source };
  } catch (e) {
    console.error("Failed to play PCM audio", e);
    throw e;
  }
}
