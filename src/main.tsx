import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// 브라우저 콘솔에도 서버/앱 시작 메시지
if (import.meta.env.DEV) {
  console.log('%c[Jaydee] 🎹 Cloud DAW가 로드되었습니다. 터미널에서 단축키 안내를 확인하세요.', 'color:#60a5fa')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
