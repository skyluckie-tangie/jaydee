import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 서버가 열릴 때 예쁜 메시지를 출력하는 플러그인
function jaydeeServerMessage() {
  return {
    name: 'jaydee-server-message',
    configureServer(server: any) {
      // 기본 Vite URL 출력은 우리가 직접 출력할 거라서 막음
      server.printUrls = () => {}

      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address()
        const port = typeof address === 'object' && address ? address.port : 5173

        const cyan = '\x1b[36m'
        const green = '\x1b[32m'
        const yellow = '\x1b[33m'
        const reset = '\x1b[0m'
        const bold = '\x1b[1m'

        console.log('')
        console.log(cyan + bold + '🎹  Jaydee — Cloud Collaborative DAW' + reset)
        console.log(green + '   ✓ 서버가 열렸습니다!' + reset)
        console.log('')
        console.log(`   ${cyan}Local:${reset}     http://localhost:${port}/`)
        console.log(`   ${cyan}Network:${reset}   http://<LAN IP>:${port}/  (다른 기기에서 접속할 때 --host 옵션 사용)`)
        console.log('')

        console.log(yellow + '   단축키' + reset)
        console.log('     Space               재생 / 일시정지')
        console.log('     Delete / Backspace  선택 클립 삭제')
        console.log('     MIDI 클립 더블클릭   Piano Roll 편집기 열기')
        console.log('     + MIDI Clip 버튼     새 MIDI 클립 추가')
        console.log('')

        console.log(yellow + '   현재 단계' + reset + ': ' + bold + 'Phase 5–6 — Cloud save + Export + Polish' + reset)
        console.log('   Ctrl+S Save | Ctrl+E Export | Load Demo for test mix\n')
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    jaydeeServerMessage(),
  ],
  server: {
    host: 'localhost',   // Force IPv4 + IPv6 localhost binding
    port: 5173,
    strictPort: false,
    open: true,          // YOLO mode: auto-open browser on start
  },
})
