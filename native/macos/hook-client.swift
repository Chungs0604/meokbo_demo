// Claude Code 훅 / statusLine 커맨드.
//
// 사용법: hook-client <event>        (stdin 으로 Claude Code 가 JSON payload 를 준다)
//
// 원칙 — 이 프로그램은 Claude Code 를 절대 느리게 만들면 안 된다.
//   * 훅은 2초 타임아웃이 걸려 있다. 여기서는 소켓에 쓰고 바로 끝낸다. 응답을 기다리지 않는다.
//   * claude-cs 앱이 꺼져 있으면 소켓 연결이 즉시 실패한다. 그래도 조용히 exit 0 한다.
//     훅이 실패하면 Claude Code 쪽에 에러가 뜨기 때문이다.
//   * Node 로 짜면 기동에만 43ms 가 든다. statusLine 은 렌더링마다 호출되므로 네이티브로 둔다 (3.6ms).

import Foundation

let args = Array(CommandLine.arguments.dropFirst())
let event = args.first ?? "unknown"

func socketPath() -> String {
    if let override = ProcessInfo.processInfo.environment["CLAUDE_CS_SOCKET"], !override.isEmpty {
        return override
    }
    if let index = args.firstIndex(of: "--socket"), index + 1 < args.count {
        return args[index + 1]
    }
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    return "\(home)/Library/Application Support/claude-cs/ipc.sock"
}

/// statusLine 용 한 줄. payload 안에 이미 사용률이 있으므로 앱에 묻지 않고 직접 만든다.
/// 앱이 꺼져 있어도 상태줄은 정상 동작한다.
func statusLineText(_ payload: [String: Any]) -> String {
    guard let limits = payload["rate_limits"] as? [String: Any] else { return "" }

    func percent(_ key: String) -> Int? {
        guard let window = limits[key] as? [String: Any],
              let used = window["used_percentage"] as? Double else { return nil }
        return Int(used.rounded())
    }

    var parts: [String] = []
    if let five = percent("five_hour") { parts.append("5h \(five)%") }
    if let week = percent("seven_day") { parts.append("7d \(week)%") }
    return parts.joined(separator: " · ")
}

/// 유닉스 소켓에 한 줄 보내고 즉시 닫는다. 실패는 무시한다 (앱이 꺼져 있는 게 정상 상황이다).
func send(_ line: String, to path: String) {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    if fd < 0 { return }
    defer { close(fd) }

    // 앱이 멈춰 있어도 훅이 매달리지 않도록 송수신 타임아웃을 짧게 건다.
    var timeout = timeval(tv_sec: 0, tv_usec: 200_000)
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))

    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let pathBytes = Array(path.utf8)
    // sun_path 는 104 바이트다. 넘으면 연결할 수 없다.
    guard pathBytes.count < MemoryLayout.size(ofValue: addr.sun_path) else { return }
    withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
        ptr.withMemoryRebound(to: CChar.self, capacity: pathBytes.count + 1) { dst in
            for (i, byte) in pathBytes.enumerated() { dst[i] = CChar(bitPattern: byte) }
            dst[pathBytes.count] = 0
        }
    }

    let size = socklen_t(MemoryLayout<sockaddr_un>.size)
    let connected = withUnsafePointer(to: &addr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, size) }
    }
    if connected < 0 { return }

    let data = Array((line + "\n").utf8)
    _ = data.withUnsafeBytes { write(fd, $0.baseAddress, $0.count) }
}

let input = FileHandle.standardInput.readDataToEndOfFile()
let payload = (try? JSONSerialization.jsonObject(with: input)) as? [String: Any] ?? [:]

// statusLine 은 stdout 이 곧 화면에 찍히는 내용이다. 소켓보다 먼저 처리한다.
if event == "statusline" {
    print(statusLineText(payload))
}

let message: [String: Any] = ["event": event, "payload": payload]
if let data = try? JSONSerialization.data(withJSONObject: message),
   let line = String(data: data, encoding: .utf8) {
    send(line, to: socketPath())
}

exit(0)
