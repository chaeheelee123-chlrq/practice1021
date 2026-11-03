# Talk English

Mina와 자유롭게 영어 대화를 연습하는 챗봇입니다. 브라우저에서 문장을 쓰면 이어지는 질문과 짧은 한국어 힌트를 받을 수 있습니다.

## 실행

Node.js가 필요합니다.

```bash
node server.js
```

브라우저에서 [http://127.0.0.1:8787](http://127.0.0.1:8787)을 엽니다. 서버는 이 컴퓨터에서만 접속할 수 있습니다.

## API 키

키는 `.env`에만 둡니다. 페이지 소스나 Git에는 들어가지 않습니다.

```bash
copy .env.example .env
```

OpenRouter를 쓰려면 `.env`에 이렇게 저장합니다.

```
OPENROUTER_API_KEY=sk-or-v1-여기에키
OPENROUTER_MODEL=openai/gpt-4o-mini
```

OpenAI 키만 있으면 `OPENAI_API_KEY`로도 동작합니다. 키를 저장한 뒤에는 서버를 다시 실행하세요.

키가 없거나 API가 응답하지 않으면, 페이지 안의 연습용 답변으로 대화를 이어갑니다.

## 연습 기능

- 주제: 자유 대화, 하루, 음식, 취미, 여행, 주말, 학교, 카페 역할극
- 초급 / 중급
- 말한 문장의 더 자연스러운 표현
- 음성으로 듣기, 마이크로 말하기 (Chrome)

## 파일

| 파일 | 설명 |
| --- | --- |
| `index.html` | 대화 화면 |
| `server.js` | 페이지를 열고 API 요청을 대신 보냄 |
| `.env.example` | 키 변수 이름 예시 |
| `.gitignore` | `.env`를 Git에서 제외 |
