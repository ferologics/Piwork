// Finds Piwork window ID without stealing focus
// Outputs the main window (largest) ID

import Cocoa

let options = CGWindowListOption(arrayLiteral: .excludeDesktopElements)
guard let windowList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
    exit(1)
}

var bestWindow: (id: Int, area: Int) = (0, 0)

for window in windowList {
    guard let ownerName = window[kCGWindowOwnerName as String] as? String,
          let windowNumber = window[kCGWindowNumber as String] as? Int,
          ownerName.lowercased() == "piwork",
          let bounds = window[kCGWindowBounds as String] as? [String: Any],
          let width = bounds["Width"] as? Int,
          let height = bounds["Height"] as? Int else {
        continue
    }

    let area = width * height
    if area > bestWindow.area {
        bestWindow = (windowNumber, area)
    }
}

if bestWindow.id != 0 {
    print(bestWindow.id)
    exit(0)
}

exit(1)
