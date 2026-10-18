# Nemotron 챗봇

OpenRouter의 무료 NVIDIA Nemotron 모델을 쓰는 간단한 챗봇입니다. Vercel에 바로 배포할 수 있습니다.

- `public/index.html` — 채팅 화면 (스트리밍 응답)
- `api/chat.js` — OpenRouter 프록시 (API 키는 서버에만 보관)

## Vercel 환경변수

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | ✅ | OpenRouter API 키 |
| `OPENROUTER_MODEL` |  | 기본값 `nvidia/nemotron-3-super-120b-a12b:free` |
| `SITE_URL` |  | OpenRouter 통계용 사이트 주소 |

빌드 설정은 필요 없습니다 (Framework Preset: Other).
