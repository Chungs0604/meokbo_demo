// 상주형 창 감시 헬퍼 (macOS).
//
// 변화가 있을 때만 stdout 에 NDJSON 한 줄을 쓴다.
//
// 설계상 중요한 점: "맨 위 창이 누구냐"를 묻지 않는다.
// CGWindowList 의 앞뒤 순서는 앱 전환 순간 수십 ms 동안 뒤집혔다 돌아오는 일이 있어서,
// 60Hz 로 읽으면 캐릭터가 깜빡인다. 대신
//   1) 활성 앱은 NSWorkspace 활성화 "알림"으로 받고 (푸시, 글리치 없음)
//   2) CGWindowList 는 그 앱의 창 bounds 를 찾는 데만 쓴다.
// 이러면 순서 글리치가 결과에 영향을 주지 않는다.
//
// 창 "제목"은 읽지 않으므로 화면 기록·손쉬운 사용 권한이 모두 불필요하다.
// 오버레이 자신은 screen-saver 레벨(layer 1000)이라 layer == 0 필터에서 자동으로 빠진다.

import AppKit
import CoreGraphics
import Foundation

struct Sample: Equatable {
    let pid: pid_t
    let bundleId: String
    let appName: String
    let x: Int, y: Int, width: Int, height: Int
}

var excludePids = Set<pid_t>([ProcessInfo.processInfo.processIdentifier])
var argIterator = CommandLine.arguments.dropFirst().makeIterator()
while let arg = argIterator.next() {
    if arg == "--exclude-pid", let raw = argIterator.next(), let pid = pid_t(raw) {
        excludePids.insert(pid)
    }
}

/// 화면들의 합집합을 CG 좌표계(좌상단 원점)로 돌려준다.
/// NSScreen 은 좌하단 원점이라 변환이 필요하다.
func screenRectsInCGSpace() -> [CGRect] {
    guard let main = NSScreen.screens.first else { return [] }
    let mainHeight = main.frame.height
    return NSScreen.screens.map { screen in
        let f = screen.frame
        return CGRect(x: f.origin.x, y: mainHeight - (f.origin.y + f.height), width: f.width, height: f.height)
    }
}

final class Watcher {
    private var activeApp: NSRunningApplication?
    /// 화면 구성은 거의 바뀌지 않는데 NSScreen 조회는 비싸다. 캐시하고 가끔만 갱신한다.
    private var cachedScreens: [CGRect] = []
    private var screensRefreshedAt: TimeInterval = 0
    private let screenCacheTTL: TimeInterval = 2.0
    private var last: Sample?
    private var emittedOnce = false
    private var ticksSinceChange = 0

    /// 마지막 변화 후 약 2초(125틱)는 매 틱 확인하고, 그 뒤에는 12틱마다(약 200ms) 확인한다.
    private let activeTickBudget = 125
    private let idleTickStride = 12
    private var tick = 0

    private func screens() -> [CGRect] {
        let now = Date().timeIntervalSince1970
        if now - screensRefreshedAt > screenCacheTTL || cachedScreens.isEmpty {
            cachedScreens = screenRectsInCGSpace()
            screensRefreshedAt = now
        }
        return cachedScreens
    }

    init() {
        activeApp = NSWorkspace.shared.frontmostApplication
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: nil
        ) { [weak self] note in
            guard let self,
                  let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            else { return }
            self.activeApp = app
            // 전환 직후는 창이 자리를 잡는 중이므로 고속 확인 구간으로 되돌린다.
            self.ticksSinceChange = 0
            self.check()
        }
    }

    /// 활성 앱이 소유한 창 중 가장 앞의 일반 창.
    private func currentSample() -> Sample? {
        guard let app = activeApp else { return nil }
        let pid = app.processIdentifier
        if excludePids.contains(pid) { return nil }

        let options = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
        guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
            return nil
        }

        let screens = self.screens()

        for window in list {
            guard let layer = window[kCGWindowLayer as String] as? Int, layer == 0,
                  let owner = window[kCGWindowOwnerPID as String] as? Int, pid_t(owner) == pid,
                  let bounds = window[kCGWindowBounds as String] as? [String: CGFloat]
            else { continue }

            let width = Int(bounds["Width"] ?? 0)
            let height = Int(bounds["Height"] ?? 0)
            if width <= 0 || height <= 0 { continue }   // 유령 창

            // 앱이 화면 밖에 숨겨 둔 보조 창(Chrome 의 숨은 패널 등)을 집지 않도록,
            // 실제로 화면에 걸쳐 있는 창만 본다. 전체가 화면 밖이면 사용자가 볼 수 없는 창이다.
            let rect = CGRect(x: bounds["X"] ?? 0, y: bounds["Y"] ?? 0,
                              width: CGFloat(width), height: CGFloat(height))
            if !screens.contains(where: { $0.intersects(rect) }) { continue }

            return Sample(
                pid: pid,
                bundleId: app.bundleIdentifier ?? "",
                appName: app.localizedName ?? "",
                x: Int(bounds["X"] ?? 0),
                y: Int(bounds["Y"] ?? 0),
                width: width,
                height: height
            )
        }
        return nil
    }

    func check() {
        let sample = currentSample()
        guard !emittedOnce || sample != last else {
            ticksSinceChange += 1
            return
        }
        last = sample
        emittedOnce = true
        ticksSinceChange = 0
        emit(sample)
    }

    func onTick() {
        // 부모(Electron)가 죽으면 고아로 남지 않게 같이 종료한다.
        if getppid() == 1 { exit(0) }

        tick += 1
        if ticksSinceChange >= activeTickBudget && tick % idleTickStride != 0 { return }
        check()
    }
}

func emit(_ sample: Sample?) {
    let object: [String: Any]
    if let sample {
        object = [
            "type": "window",
            "pid": Int(sample.pid),
            "bundleId": sample.bundleId,
            "appName": sample.appName,
            "bounds": ["x": sample.x, "y": sample.y, "width": sample.width, "height": sample.height],
        ]
    } else {
        object = ["type": "none"]
    }
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
}

// 파이프로 연결되면 stdout 이 블록 버퍼링된다. 실시간 전달을 위해 버퍼링을 끈다.
setbuf(stdout, nil)

let watcher = Watcher()
watcher.check()

// NSWorkspace 알림을 받으려면 run loop 가 돌아야 한다.
Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { _ in watcher.onTick() }
RunLoop.main.run()
