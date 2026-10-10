"""Regenerate the public product-film narration; never use formant speech.
This utility is isolated to the video/mandarin-voice-20261010 branch.
It does not read credentials, contact MCP, edit the application, or deploy it.
Usage: python tools/video_voiceover/synthesize.py edge|kokoro|check
"""
from pathlib import Path
import asyncio
import json
import os
import subprocess
import sys
import time

OUT = Path('voiceover-output')
OUT.mkdir(exist_ok=True)
LINES = [
    {'start': 0.70, 'end': 5.70, 'text': '你去过的麦当劳，能连成一张地图吗？'},
    {'start': 6.65, 'end': 9.45, 'text': '这就是麦麦中国地图。'},
    {'start': 9.90, 'end': 13.35, 'text': '用麦当劳，画出自己的中国足迹。'},
    {'start': 14.20, 'end': 17.50, 'text': '搜一座城，找一家特别的店。'},
    {'start': 18.15, 'end': 21.85, 'text': '看看照片、地址，还有它的故事。'},
    {'start': 22.65, 'end': 25.70, 'text': '下一站，先收藏起来。'},
    {'start': 26.85, 'end': 29.90, 'text': '去过之后，就留一页手账。'},
    {'start': 30.45, 'end': 34.25, 'text': '吃了什么，拍了什么，再写两句。'},
    {'start': 35.20, 'end': 39.50, 'text': '回到地图，按年份翻翻自己的足迹。'},
    {'start': 40.30, 'end': 43.20, 'text': '做成分享卡，发给朋友。'},
    {'start': 43.70, 'end': 47.20, 'text': '也能导出备份，留给以后的自己。'},
    {'start': 48.20, 'end': 51.00, 'text': '用一家家去过的麦当劳，'},
    {'start': 51.30, 'end': 54.50, 'text': '串起我们走过的中国城市。'},
]
(OUT / 'script.json').write_text(json.dumps(LINES, ensure_ascii=False, indent=2), encoding='utf-8')


def save_meta(data):
    (OUT / 'voice-info.json').write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def to_wav(src, dst):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(src), '-ar', '48000', '-ac', '1', str(dst)], check=True)


async def make_edge():
    import edge_tts
    voice = 'zh-CN-XiaoxiaoNeural'
    for i, row in enumerate(LINES):
        media = OUT / f'line_{i:02}.mp3'
        metadata = []
        for attempt in range(2):
            try:
                communicate = edge_tts.Communicate(row['text'], voice, rate='+0%', pitch='+0Hz')
                async def generate():
                    with media.open('wb') as f:
                        async for event in communicate.stream():
                            if event['type'] == 'audio':
                                f.write(event['data'])
                            else:
                                metadata.append(event)
                await asyncio.wait_for(generate(), timeout=35)
                assert media.stat().st_size > 1000, 'Empty audio'
                break
            except Exception:
                if attempt == 1:
                    raise
                await asyncio.sleep(2)
        to_wav(media, OUT / f'line_{i:02}.wav')
        (OUT / f'line_{i:02}.boundaries.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'NEURAL {i+1}/{len(LINES)}: {row["text"]}', flush=True)
        await asyncio.sleep(0.6)
    save_meta({'engine': 'Microsoft Edge neural text-to-speech', 'voice': voice, 'language': 'zh-CN', 'synthetic': True, 'rate': '+0%', 'formant_synthesizer': False})
    (OUT / 'EDGE_OK').write_text('ok')


def make_kokoro():
    import numpy as np
    import soundfile as sf
    import torch
    from kokoro import KPipeline
    torch.set_num_threads(3)
    torch.manual_seed(1023)
    repo = 'hexgrad/Kokoro-82M-v1.1-zh'
    pipeline = KPipeline(lang_code='z', repo_id=repo, device='cpu')
    voice = 'zf_001'
    all_phonemes = []
    for i, row in enumerate(LINES):
        result = list(pipeline(row['text'], voice=voice, speed=1.0))
        waves = [r.audio.detach().cpu().numpy() for r in result if r.audio is not None]
        assert waves, f'No neural output for {i}'
        data = np.concatenate(waves)
        temp = OUT / f'kokoro_{i:02}.wav'
        sf.write(temp, data, 24000)
        to_wav(temp, OUT / f'line_{i:02}.wav')
        all_phonemes.append({'text': row['text'], 'phonemes': [r.phonemes for r in result]})
        print(f'NEURAL {i+1}/{len(LINES)}: {row["text"]}', flush=True)
    (OUT / 'phonemes.json').write_text(json.dumps(all_phonemes, ensure_ascii=False, indent=2), encoding='utf-8')
    save_meta({'engine': 'Kokoro neural text-to-speech', 'model': repo, 'voice': voice, 'language': 'Mandarin Chinese', 'synthetic': True, 'speed': 1.0, 'formant_synthesizer': False})


def check_audio():
    import numpy as np
    import soundfile as sf
    import re
    from faster_whisper import WhisperModel
    from opencc import OpenCC
    cc = OpenCC('t2s')
    model = WhisperModel('base', device='cpu', compute_type='int8', cpu_threads=3)
    checks = []
    for i, row in enumerate(LINES):
        path = OUT / f'line_{i:02}.wav'
        data, sr = sf.read(path)
        segs, info = model.transcribe(str(path), language='zh', beam_size=5, condition_on_previous_text=False, vad_filter=False)
        recognized = cc.convert(''.join(s.text for s in segs))
        checks.append({'line': i, 'expected': row['text'], 'recognized': recognized, 'duration': len(data)/sr, 'sample_rate': sr, 'peak': float(np.max(np.abs(data))), 'rms': float(np.sqrt(np.mean(data**2))), 'method': 'independent faster-whisper base zh transcription; not phonetic human review'})
        print(json.dumps(checks[-1], ensure_ascii=False), flush=True)
    (OUT / 'asr-check.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'edge':
        try:
            asyncio.run(make_edge())
        except Exception as exc:
            print(f'Edge unavailable: {type(exc).__name__}: {exc}', flush=True)
            (OUT / 'edge-error.txt').write_text(f'{type(exc).__name__}: {exc}', encoding='utf-8')
    elif mode == 'kokoro':
        make_kokoro()
    elif mode == 'check':
        check_audio()
    else:
        raise SystemExit('Use edge, kokoro, or check')
